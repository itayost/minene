import { afterEach, describe, expect, test } from 'vitest';
import { DEFAULT_RULES, initialState } from '../../src/persuade/engine/rules';
import { applyTargetReply, persuaderTurn } from '../../src/persuade/engine/turn';
import type { Turn } from '../../src/persuade/engine/types';
import { setModelOverrides } from '../../src/persuade/lib/model';
import { jsonModel, PERSUADER_PAYLOAD, TEST_PLAN } from './helpers';

const greetingPayload = {
  ...PERSUADER_PAYLOAD,
  message: 'אהלן עדי, אני פונה אליך בשם אושר. מה שלומך?',
  asksForDecision: false,
  statesAsk: false,
  setsStartTime: false,
  announcesFollowUp: false,
  argumentsUsed: 0,
  blocker: 'none',
};

afterEach(() => setModelOverrides({}));

describe('interaction accounting', () => {
  test('the greeting does not spend one of the four attempts', async () => {
    setModelOverrides({ persuader: jsonModel([greetingPayload]) });

    const result = await persuaderTurn(TEST_PLAN, [], initialState());

    expect(result.state.interaction).toBe(0);
    expect(result.state.askStated).toBe(false);
    expect(result.stopped.stop).toBe(false);
  });

  test('stating the ask starts the count', async () => {
    setModelOverrides({ persuader: jsonModel([PERSUADER_PAYLOAD]) });
    const greeted: Turn[] = [{ role: 'persuader', text: 'אהלן', interaction: 0 }];

    const result = await persuaderTurn(TEST_PLAN, greeted, initialState());

    expect(result.state.interaction).toBe(1);
    expect(result.state.askStated).toBe(true);
  });

  test('once the ask is on the table every turn counts', async () => {
    setModelOverrides({ persuader: jsonModel([{ ...PERSUADER_PAYLOAD, statesAsk: false }]) });
    const state = { ...initialState(), interaction: 2, askStated: true };

    const result = await persuaderTurn(
      TEST_PLAN,
      [{ role: 'persuader', text: 'x', interaction: 1 }],
      state,
    );

    expect(result.state.interaction).toBe(3);
  });

  test('the closure flags the follow-up needs are accumulated', async () => {
    setModelOverrides({ persuader: jsonModel([PERSUADER_PAYLOAD]) });

    const result = await persuaderTurn(TEST_PLAN, [], initialState());

    expect(result.state.startTimeSet).toBe(true);
    expect(result.state.followUpAnnounced).toBe(true);
  });
});

describe('reading the counterpart', () => {
  test('an explicit yes closes the conversation', () => {
    const applied = applyTargetReply('סגור, אני עושה את זה', [], initialState(), DEFAULT_RULES);
    expect(applied.state.outcome).toBe('agreed');
    expect(applied.stopped.stop).toBe(true);
  });

  test('a hedge keeps it open', () => {
    const applied = applyTargetReply(
      'אני אחשוב על זה ואחזור אליך בהמשך השבוע',
      [],
      initialState(),
      DEFAULT_RULES,
    );
    expect(applied.state.outcome).toBe('open');
    expect(applied.stopped.stop).toBe(false);
  });
});

describe('reading a yes the keywords would miss', () => {
  test('a conditional agreement is recognised', async () => {
    setModelOverrides({
      persuader: jsonModel([{ ...PERSUADER_PAYLOAD, counterpartCommitted: true }]),
    });

    const result = await persuaderTurn(
      TEST_PLAN,
      [
        { role: 'persuader', text: 'מתחילים מחר?', interaction: 1 },
        { role: 'target', text: 'אם אתה בודק, אז בסדר. מחר לפני הפתיחה.', interaction: 1 },
      ],
      { ...initialState(), interaction: 1, askStated: true },
    );

    expect(result.state.outcome).toBe('agreed');
    expect(result.stopped.stop).toBe(true);
  });

  test('an explicit refusal read by the model also stops it', async () => {
    setModelOverrides({
      persuader: jsonModel([{ ...PERSUADER_PAYLOAD, counterpartRefused: true }]),
    });

    const result = await persuaderTurn(
      TEST_PLAN,
      [
        { role: 'persuader', text: 'מתחילים מחר?', interaction: 1 },
        { role: 'target', text: 'לא, אני לא עושה את זה', interaction: 1 },
      ],
      { ...initialState(), interaction: 1, askStated: true },
    );

    expect(result.state.outcome).toBe('refused');
  });
});

describe('a counter-offer is not a yes', () => {
  test('the read is ignored before the ask has been stated', async () => {
    setModelOverrides({
      persuader: jsonModel([{ ...PERSUADER_PAYLOAD, statesAsk: false, counterpartCommitted: true }]),
    });

    const result = await persuaderTurn(
      TEST_PLAN,
      [
        { role: 'persuader', text: 'אהלן, מה שלומך?', interaction: 0 },
        { role: 'target', text: 'בסדר, מה צריך?', interaction: 0 },
      ],
      initialState(),
    );

    expect(result.state.outcome).toBe('open');
  });

  test('the read is ignored when nobody has answered yet', async () => {
    setModelOverrides({
      persuader: jsonModel([{ ...PERSUADER_PAYLOAD, counterpartCommitted: true }]),
    });

    const result = await persuaderTurn(TEST_PLAN, [], initialState());

    expect(result.state.outcome).toBe('open');
  });
});

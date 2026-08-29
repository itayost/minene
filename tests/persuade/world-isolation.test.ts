/**
 * @vitest-environment node
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { persuaderSystemPrompt, targetSystemPrompt } from '../../src/persuade/engine/prompts'
import { DEFAULT_RULES, initialState } from '../../src/persuade/engine/rules'
import { buildWorld, personaInWorld, worldCells } from '../../src/persuade/engine/world'
import { TEST_PERSONA, TEST_PLAN } from './helpers'

const source = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')

const world = buildWorld({
  motivation: 'low',
  workload: 'crushing',
  reason: 'low_confidence',
  pressureResponse: 'withdraws',
  disposition: 'rational',
})

/**
 * The property the whole lab rests on: the simulated employee knows why he has
 * not done it, and the persuader has to find out. Leak the world into the
 * persuader's prompt and every number the lab produces is a measurement of a
 * bot reading an answer key.
 */
describe('the persuader cannot see the world', () => {
  it('has no parameter the world could be passed to', () => {
    // Structural, not conventional. persuaderSystemPrompt takes the plan, the
    // state, the rules and the recipient -- there is nowhere to put a world,
    // so a future caller cannot pass one by mistake.
    expect(persuaderSystemPrompt.length).toBeLessThanOrEqual(5)
    // Bounded at the target's prompt, which legitimately does mention the
    // world -- reading to end of file would slice that in and pass nothing.
    const prompts = source('src/persuade/engine/prompts.ts')
    const persuaderFn = prompts.slice(
      prompts.indexOf('export function persuaderSystemPrompt'),
      // Bound at the target's DOC COMMENT, not its signature: the comment
      // above it names WorldState to say the world belongs there and nowhere
      // else, and slicing that in would fail the check it exists to describe.
      prompts.indexOf("The counterpart's prompt"),
    )
    expect(persuaderFn.length).toBeGreaterThan(200)
    expect(persuaderFn).not.toMatch(/WorldState|describeWorld/)
  })

  it('never renders the hidden truth or the win condition', () => {
    const rendered = persuaderSystemPrompt(TEST_PLAN, initialState(), true, DEFAULT_RULES, {
      name: 'עדי',
      role: 'מנהלת חנות',
    })

    expect(rendered).not.toContain(world.hiddenTruth)
    expect(rendered).not.toContain('מתי אתה מסכים')
    expect(rendered).not.toContain('נשארו לך')
  })

  it('gives the simulated employee all of it', () => {
    const rendered = targetSystemPrompt(TEST_PERSONA, TEST_PLAN, world)

    expect(rendered).toContain(world.hiddenTruth)
    expect(rendered).toContain('נשארו לך 20 דקות')
    // The conditions are a checklist, so agreement is earned against a written
    // standard rather than decided by mood.
    expect(rendered).toContain('מישהו הכיר בעומס שלך לפני שביקש')
  })

  it('still works with no world, the way a hand-started run does', () => {
    const rendered = targetSystemPrompt(TEST_PERSONA, TEST_PLAN)

    expect(rendered).toContain(TEST_PERSONA.hiddenTruth)
    expect(rendered).toContain(TEST_PERSONA.agreesWhen)
  })

  it('hands the world to the counterpart and to nothing else', () => {
    // simulation.ts is where a leak would actually happen: it holds the world
    // and calls both sides.
    const sim = source('src/persuade/engine/simulation.ts')
    const persuaderCall = sim.slice(
      sim.indexOf('persuaderTurn('),
      sim.indexOf('turns.push(p.turn)'),
    )
    expect(persuaderCall).not.toMatch(/world/)
    expect(sim).toMatch(/targetReply\(persona, plan, turns, world\)/)
  })
})

describe('the space of worlds', () => {
  it('enumerates every combination, so coverage is a fact rather than a hope', () => {
    // 3 motivations x 3 workloads x 6 reasons x 3 pressure responses x 2
    // dispositions.
    expect(worldCells()).toHaveLength(324)
    expect(new Set(worldCells().map((c) => JSON.stringify(c))).size).toBe(324)
  })

  it('lets disposition change what it would take, not just what is printed', () => {
    // An axis that does not change how the person behaves is noise added to
    // every cell. A rational person wants the number; an emotional one wants
    // to know what it means for them.
    const base = { motivation: 'medium', workload: 'normal', reason: 'no_value' } as const
    const rational = buildWorld({ ...base, pressureResponse: 'withdraws', disposition: 'rational' })
    const emotional = buildWorld({
      ...base,
      pressureResponse: 'withdraws',
      disposition: 'emotional',
    })

    expect(rational.agreesWhen).toContain('numbers_shown')
    expect(rational.agreesWhen).not.toContain('personal_benefit_named')
    expect(emotional.agreesWhen).toContain('personal_benefit_named')
  })

  it('makes an emotional counterpart require being heard first', () => {
    // Strictly one condition harder, and real rather than a bug: being heard
    // is the cost of persuading someone who takes it personally.
    const emotional = buildWorld({
      motivation: 'medium',
      workload: 'normal',
      reason: 'forgot',
      pressureResponse: 'withdraws',
      disposition: 'emotional',
    })
    const rational = buildWorld({
      motivation: 'medium',
      workload: 'normal',
      reason: 'forgot',
      pressureResponse: 'withdraws',
      disposition: 'rational',
    })

    expect(emotional.agreesWhen).toContain('acknowledged_the_load')
    expect(emotional.agreesWhen.length).toBeGreaterThan(rational.agreesWhen.length)
  })

  it('couples the win condition to the reason, so a world is coherent', () => {
    // A person who forgot needs reminding and a small ask. A person who does not
    // see the value needs the value named, and no amount of reminding touches
    // them. Crossing the dimensions freely would produce worlds where the
    // winning move has nothing to do with the problem.
    // Held at one disposition so this checks the reason coupling alone --
    // disposition rewrites the result afterwards and has its own tests.
    const cell = { ...worldCells()[0]!, disposition: 'rational' as const }
    expect(buildWorld({ ...cell, reason: 'forgot' }).agreesWhen).toEqual(['ask_made_small'])
    expect(buildWorld({ ...cell, reason: 'disagrees' }).agreesWhen).toEqual(['asked_for_their_way'])
    // no_value asks for the value to be named; for a rational counterpart that
    // is a number rather than a feeling.
    expect(buildWorld({ ...cell, reason: 'no_value' }).agreesWhen).toEqual(['numbers_shown'])
    expect(
      buildWorld({ ...cell, reason: 'no_value', disposition: 'emotional' }).agreesWhen,
    ).toContain('personal_benefit_named')
  })

  it('is reproducible: the same cell is always the same world', () => {
    const cell = worldCells()[40]!
    expect(buildWorld(cell)).toEqual(buildWorld(cell))
  })

  it('derives resistance rather than taking the persona’s', () => {
    const easy = personaInWorld(
      TEST_PERSONA,
      buildWorld({
        motivation: 'high',
        workload: 'light',
        reason: 'forgot',
        pressureResponse: 'withdraws',
        disposition: 'rational',
      }),
    )
    const hard = personaInWorld(
      TEST_PERSONA,
      buildWorld({
        motivation: 'low',
        workload: 'crushing',
        reason: 'disagrees',
        pressureResponse: 'digs_in',
        disposition: 'rational',
      }),
    )

    expect(easy.resistance).toBeLessThan(hard.resistance)
    // The persona keeps its voice; the world owns the circumstance.
    expect(hard.name).toBe(TEST_PERSONA.name)
    expect(hard.style).toBe(TEST_PERSONA.style)
    expect(hard.hiddenTruth).not.toBe(TEST_PERSONA.hiddenTruth)
  })
})

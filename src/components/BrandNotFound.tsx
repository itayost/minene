type BrandNotFoundProps = {
  brandId: string
}

export function BrandNotFound({ brandId }: BrandNotFoundProps) {
  return (
    <main className="brand-not-found">
      <div className="brand-not-found__card">
        <h1>Brand not found</h1>
        <p>There is no configured brand named “{brandId}”.</p>
        <a href="/">Go to the default brand</a>
      </div>
    </main>
  )
}

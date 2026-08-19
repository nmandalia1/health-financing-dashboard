export default function CountryLoading() {
  return (
    <div className="space-y-6">
      <div>
        <div className="h-8 w-64 animate-pulse rounded bg-muted" />
        <div className="mt-2 h-5 w-96 animate-pulse rounded bg-muted" />
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="h-20 animate-pulse rounded-lg border bg-muted"
          />
        ))}
      </div>
      <div className="h-[400px] animate-pulse rounded-lg border bg-muted" />
    </div>
  );
}

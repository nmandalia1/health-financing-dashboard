import Link from "next/link";

export default function CountryNotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-2xl font-semibold">Country not found</h1>
      <p className="text-muted-foreground">
        The country code you entered doesn&apos;t match any country in our
        database.
      </p>
      <Link
        href="/"
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
      >
        Search for a country
      </Link>
    </div>
  );
}

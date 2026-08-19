import { redirect } from "next/navigation";

/** The lens has no view of its own — it opens on its first sub-view. */
export default async function DiseasesIndex({
  params,
}: {
  params: Promise<{ iso3: string }>;
}) {
  const { iso3 } = await params;
  redirect(`/country/${iso3}/diseases/hiv`);
}

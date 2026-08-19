"use client";

import { useParams } from "next/navigation";
import { notFound } from "next/navigation";
import { DiseasesView, type Disease } from "@/components/views/diseases/diseases-view";

const DISEASES: Disease[] = ["hiv", "tb", "malaria", "ncds"];

export default function DiseasePage() {
  const params = useParams<{ iso3: string; disease: string }>();
  const disease = params.disease.toLowerCase() as Disease;
  if (!DISEASES.includes(disease)) notFound();
  return <DiseasesView iso3={params.iso3.toUpperCase()} active={disease} />;
}

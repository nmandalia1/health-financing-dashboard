"use client";

import { useParams } from "next/navigation";
import { ImmunizationView } from "@/components/views/immunization/immunization-view";

export default function ImmunizationPage() {
  const params = useParams<{ iso3: string }>();
  return <ImmunizationView iso3={params.iso3.toUpperCase()} />;
}

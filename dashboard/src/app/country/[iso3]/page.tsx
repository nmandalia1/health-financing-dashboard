"use client";

import { useParams } from "next/navigation";
import { FinancingLandscape } from "@/components/views/financing-landscape/financing-landscape";

export default function FinancingLandscapePage() {
  const params = useParams<{ iso3: string }>();
  return <FinancingLandscape iso3={params.iso3.toUpperCase()} />;
}

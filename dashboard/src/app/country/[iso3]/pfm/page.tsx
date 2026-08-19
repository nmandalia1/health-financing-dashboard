"use client";

import { useParams } from "next/navigation";
import { PfmCountryView } from "@/components/views/pfm/pfm-country-view";

export default function CountryPfmPage() {
  const params = useParams<{ iso3: string }>();
  return <PfmCountryView iso3={params.iso3.toUpperCase()} />;
}

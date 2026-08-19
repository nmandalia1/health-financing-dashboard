"use client";

import { useParams } from "next/navigation";
import { PhcView } from "@/components/views/phc/phc-view";

export default function PhcPage() {
  const params = useParams<{ iso3: string }>();
  return <PhcView iso3={params.iso3.toUpperCase()} />;
}

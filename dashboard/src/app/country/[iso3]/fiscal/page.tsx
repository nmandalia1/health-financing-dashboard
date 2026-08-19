"use client";

import { useParams } from "next/navigation";
import { FiscalSpace } from "@/components/views/fiscal-space/fiscal-space";

export default function FiscalPage() {
  const params = useParams<{ iso3: string }>();
  return <FiscalSpace iso3={params.iso3.toUpperCase()} />;
}

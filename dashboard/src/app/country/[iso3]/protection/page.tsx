"use client";

import { useParams } from "next/navigation";
import { FinancialProtection } from "@/components/views/financial-protection/financial-protection";

export default function ProtectionPage() {
  const params = useParams<{ iso3: string }>();
  return <FinancialProtection iso3={params.iso3.toUpperCase()} />;
}

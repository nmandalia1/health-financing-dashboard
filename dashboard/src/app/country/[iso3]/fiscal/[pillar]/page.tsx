"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { PillarView } from "@/components/views/fiscal-space/pillar-view";
import { PILLARS } from "@/lib/indicator-registry";

export default function FiscalPillarPage() {
  const params = useParams<{ iso3: string; pillar: string }>();
  const iso3 = params.iso3.toUpperCase();
  const pillar = params.pillar.toLowerCase();

  if (!(pillar in PILLARS)) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">Unknown fiscal-space pillar “{pillar}”.</p>
        <Link href={`/country/${iso3}/fiscal`} className="text-sm text-blue-600 hover:underline">
          ← Back to Fiscal Space for Health
        </Link>
      </div>
    );
  }

  return <PillarView iso3={iso3} pillarKey={pillar} />;
}

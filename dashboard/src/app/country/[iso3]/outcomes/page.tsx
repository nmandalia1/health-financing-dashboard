"use client";

import { useParams } from "next/navigation";
import { OutcomesView } from "@/components/views/outcomes/outcomes-view";

export default function OutcomesPage() {
  const params = useParams<{ iso3: string }>();
  return <OutcomesView iso3={params.iso3.toUpperCase()} />;
}

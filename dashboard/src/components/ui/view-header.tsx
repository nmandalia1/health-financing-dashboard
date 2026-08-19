import type { ReactNode } from "react";

interface ViewHeaderProps {
  title: string;
  question: string;
  children?: ReactNode;
}

export function ViewHeader({ title, question, children }: ViewHeaderProps) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="text-muted-foreground">{question}</p>
      </div>
      {children && <div className="flex items-center gap-2">{children}</div>}
    </div>
  );
}

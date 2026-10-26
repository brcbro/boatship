"use client";

import { RouteError } from "@/components/shared/RouteError";

export default function AdminError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <RouteError error={error} retry={retry} homeHref="/dashboard" homeLabel="Go to Today" />;
}

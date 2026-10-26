"use client";

import { RouteError } from "@/components/shared/RouteError";

export default function PortalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <RouteError error={error} retry={retry} homeHref="/portal" homeLabel="Go to portal home" />;
}

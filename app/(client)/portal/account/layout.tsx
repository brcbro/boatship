import { AccountLayout } from "@/components/shared/account/AccountLayout";

export default function ClientAccountLayout({ children }: { children: React.ReactNode }) {
  return <AccountLayout basePath="/portal/account">{children}</AccountLayout>;
}

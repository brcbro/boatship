import { AccountLayout } from "@/components/shared/account/AccountLayout";

export default function StaffAccountLayout({ children }: { children: React.ReactNode }) {
  return <AccountLayout basePath="/account">{children}</AccountLayout>;
}

import { Confirm } from "./Confirm";

export const dynamic = "force-dynamic";

export default function ConfirmPage() {
  return (
    <main className="mx-auto max-w-sm px-5 safe-top pt-24 text-center">
      <Confirm />
    </main>
  );
}

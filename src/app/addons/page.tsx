import AddonLibrary from "@/components/addons/AddonLibrary";

export const metadata = { title: "Add-ons · Personal OS" };

export default function AddonsPage() {
  return (
    <main className="mx-auto w-full max-w-4xl space-y-6 px-4 py-6 sm:px-6 lg:py-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Add-ons</h1>
        <p className="text-sm text-muted">
          Mini apps built into Personal OS. Open one from here, or pin your favorites to the main menu.
        </p>
      </div>
      <AddonLibrary />
    </main>
  );
}

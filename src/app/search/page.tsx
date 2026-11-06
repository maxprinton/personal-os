import SearchPage from "@/components/search/SearchPage";

export const metadata = { title: "Search" };

export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  return <SearchPage initial={typeof q === "string" ? q : ""} />;
}

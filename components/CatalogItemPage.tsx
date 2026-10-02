import { notFound } from "next/navigation";
import { getSearchItem } from "@/lib/search";

export default function CatalogItemPage({ href }: { href: string }) {
  const item = getSearchItem(href);

  if (!item) notFound();

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-16">
      <p className="text-sm font-medium text-muted-foreground">{item.group}</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">
        {item.title}
      </h1>
      <p className="mt-3 max-w-2xl text-muted-foreground">{item.description}</p>
    </main>
  );
}

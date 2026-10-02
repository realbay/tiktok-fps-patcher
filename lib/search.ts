export type SearchGroup = "Pages" | "Blocks" | "Templates" | "Components";

export type SearchItem = {
  group: SearchGroup;
  title: string;
  description: string;
  href: string;
};

export const searchGroups: SearchGroup[] = ["Pages", "Blocks", "Templates", "Components"];

export const searchItems: SearchItem[] = [
  { group: "Pages", title: "Home", description: "Renaissance home", href: "/" },
  { group: "Pages", title: "Documentation", description: "Documentation", href: "/docs" },
  { group: "Pages", title: "Playground", description: "Interactive playground", href: "/playground" },
];

export function getSearchItem(href: string) {
  return searchItems.find((item) => item.href === href);
}

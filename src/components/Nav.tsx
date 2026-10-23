import Link from "next/link";

const links = [
  { href: "/", label: "Today" },
  { href: "/blocks", label: "Time blocks" },
  { href: "/events", label: "Events" },
];

export default function Nav({ active }: { active: string }) {
  return (
    <header className="border-b border-neutral-200">
      <nav className="mx-auto flex max-w-3xl items-center gap-4 px-4 py-3 text-sm">
        <span className="font-semibold">Personal OS</span>
        {links.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className={l.href === active ? "font-medium text-neutral-900" : "text-neutral-500 hover:text-neutral-900"}
          >
            {l.label}
          </Link>
        ))}
        <form action="/auth/signout" method="post" className="ml-auto">
          <button className="text-neutral-500 hover:text-neutral-900">Sign out</button>
        </form>
      </nav>
    </header>
  );
}

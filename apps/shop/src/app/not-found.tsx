import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-[80vh] flex-col items-center justify-center px-4 text-center">
      <p className="label">Not in this issue</p>
      <Link href="/" className="label mt-8 bg-ink px-6 py-3 text-white">
        Back to the store
      </Link>
    </div>
  );
}

import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center px-5 text-center">
      <h1 className="text-[32px] font-medium tracking-[-0.02em]">
        Not in this issue.
      </h1>
      <Link
        href="/"
        className="mt-8 rounded-full bg-ink px-6 py-3 text-[14px] font-medium text-canvas"
      >
        Back to the store
      </Link>
    </div>
  );
}

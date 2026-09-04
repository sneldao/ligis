/**
 * Minimal loading skeleton for the embedded verification surface.
 * Deliberately quieter than route-level skeletons: this renders inside a
 * partner's iframe, so there is no chrome — just a pulse where the
 * verdict will land.
 */
export default function EmbedVerifyLoading() {
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4 px-6 py-10">
      <div className="skeleton h-3 w-32" aria-hidden />
      <div className="skeleton h-6 w-3/4" aria-hidden />
      <div className="skeleton h-3 w-full" aria-hidden />
      <div className="skeleton h-3 w-2/3" aria-hidden />
      <div className="skeleton h-16 w-full" aria-hidden />
    </div>
  );
}

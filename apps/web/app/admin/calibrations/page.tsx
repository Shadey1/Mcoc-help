import { CalibrationsAdmin } from '../../../components/calibrations-admin';

/**
 * Admin review surface for user-submitted BHR calibration reports.
 *
 * Token-gated client-side: the page UI is always reachable, but the
 * /api/calibration-report GET endpoint won't return data without a valid
 * Bearer token (env var ADMIN_TOKEN on Cloudflare Pages). Without the
 * binding/env set, the API returns 503 and the page shows the same
 * "not configured" message.
 *
 * Not linked from the main nav — discoverable only via direct URL.
 */
export default function CalibrationsAdminPage() {
  return (
    <div className="space-y-6">
      <section>
        <h1 className="editorial-heading text-3xl mb-2">
          Calibration reports
        </h1>
        <p className="text-sm text-[var(--color-ink-soft)] max-w-2xl">
          User-submitted corrections to the BHR curves. Sorted newest first.
          Each row is one anonymous report — multiple reports for the same
          state are a signal the underlying seed value needs an update.
        </p>
      </section>
      <CalibrationsAdmin />
    </div>
  );
}

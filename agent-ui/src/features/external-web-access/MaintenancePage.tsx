import { PortalI18nProvider, usePortalI18n } from "../portal/i18n";

function MaintenancePageContent() {
  const { t } = usePortalI18n();

  return (
    <main className="auth-modern-screen">
      <div className="auth-maintenance-message" role="status">
        {t("maintenance.message")}
      </div>
    </main>
  );
}

export function MaintenancePage() {
  return (
    <PortalI18nProvider>
      <MaintenancePageContent />
    </PortalI18nProvider>
  );
}

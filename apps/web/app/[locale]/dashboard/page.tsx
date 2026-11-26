"use client";

import { BackendConfigDialog } from "@/components/features/backend";
import { AboutDialog } from "@/components/common";
import { useDashboard, type TabId } from "./hooks/use-dashboard";
import { Header } from "./components/header";
import { Sidebar } from "./components/sidebar";
import { Content } from "./components/content";

export default function DashboardPage() {
  const {
    // State
    activeTab,
    timeRange,
    timePreset,
    autoRefresh,
    isManualRefreshing,
    showBackendDialog,
    showAboutDialog,
    isFirstTime,
    autoRefreshTick,

    // Data
    data,
    countryData,
    backends,
    activeBackend,
    listeningBackends,
    activeBackendId,
    isMergedView,
    backendStatus,
    backendStatusHint,
    queryError,
    isLoading,
    isTransitioning,

    // Actions
    setActiveTab,
    setAutoRefresh,
    setShowBackendDialog,
    setShowAboutDialog,
    handleTimeRangeChange,
    handleSwitchBackend,
    handleBackendChange,
    setBackendView,
    refreshNow,

    // Theme
    theme,
    setTheme,

    // Locale/Router
    locale,
    router,
    pathname,

    // Translations
    backendT,
    dashboardT,
  } = useDashboard();

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar
        activeTab={activeTab}
        onTabChange={(tab) => setActiveTab(tab as TabId)}
        onBackendChange={handleBackendChange}
        backendStatus={backendStatus}
      />

      <main className="flex-1 min-w-0 lg:ml-0">
        <Header
          backends={backends}
          activeBackend={activeBackend}
          listeningBackends={listeningBackends}
          isMergedView={isMergedView}
          backendStatus={backendStatus}
          backendStatusHint={backendStatusHint}
          activeTab={activeTab}
          timeRange={timeRange}
          onTimeRangeChange={handleTimeRangeChange}
          autoRefresh={autoRefresh}
          autoRefreshTick={autoRefreshTick}
          onAutoRefreshToggle={() => setAutoRefresh((prev) => !prev)}
          onSwitchBackend={handleSwitchBackend}
          onOpenBackendDialog={() => setShowBackendDialog(true)}
          onRefresh={() => refreshNow(true)}
          onOpenAboutDialog={() => setShowAboutDialog(true)}
          theme={theme}
          onThemeChange={setTheme}
          locale={locale}
          pathname={pathname}
          onNavigate={(path) => router.push(path)}
          isLoading={isManualRefreshing}
          isTransitioning={isTransitioning}
          backendT={backendT}
          dashboardT={dashboardT}
        />

        <div className="p-4 lg:p-6 pb-24 lg:pb-6 max-w-7xl mx-auto">
          <Content
            activeTab={activeTab}
            data={data}
            countryData={countryData}
            error={queryError}
            timeRange={timeRange}
            timePreset={timePreset}
            isLoading={isLoading}
            isTransitioning={isTransitioning}
            autoRefresh={autoRefresh}
            activeBackendId={activeBackendId}
            backendStatus={backendStatus}
            onNavigate={(tab) => setActiveTab(tab as TabId)}
          />
        </div>
      </main>

      {/* Backend Configuration Dialog */}
      <BackendConfigDialog
        open={showBackendDialog}
        onOpenChange={setShowBackendDialog}
        isFirstTime={isFirstTime}
        onConfigComplete={() => {
          setShowBackendDialog(false);
          handleBackendChange();
        }}
        onBackendChange={handleBackendChange}
        onSetActive={() => setBackendView("single")}
      />

      {/* About Dialog */}
      <AboutDialog open={showAboutDialog} onOpenChange={setShowAboutDialog} />
    </div>
  );
}

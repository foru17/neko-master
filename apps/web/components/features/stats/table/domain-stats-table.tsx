"use client";

import { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronLeft,
  ChevronRight,
  Rows3,
  ArrowUpDown,
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronUp,
  Server,
  Download,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatBytes, formatDuration, formatNumber } from "@/lib/utils";
import { downloadTextFile, getDomainsExportFilename } from "@/lib/download-text-file";
import { cn } from "@/lib/utils";
import { api, type TimeRange } from "@/lib/api";
import { useStableTimeRange } from "@/lib/hooks/use-stable-time-range";
import { keepPreviousByIdentity } from "@/lib/query-placeholder";
import {
  getDomainIPDetailsQueryKey,
  getDomainProxyStatsQueryKey,
} from "@/lib/stats-query-keys";
import { Favicon } from "@/components/common";
import { CopyIconButton } from "@/components/common/copy-icon-button";
import { DomainPreview } from "@/components/features/domains/domain-preview";
import { DomainExpandedDetails } from "./expanded-details";
import { ProxyChainBadge } from "@/components/features/proxies/proxy-chain-badge";
import { ExpandReveal } from "@/components/ui/expand-reveal";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { InsightTableSkeleton } from "@/components/ui/insight-skeleton";
import {
  PAGE_SIZE_OPTIONS,
  getPageNumbers,
  type PageSize,
  type DomainSortKey,
  type SortOrder,
} from "@/lib/stats-utils";
import type { DomainStats } from "@neko-master/shared";

const DETAIL_QUERY_STALE_MS = 30_000;

type DomainTableMode = "local" | "remote";

interface DomainStatsTableProps {
  domains: DomainStats[];
  loading?: boolean;
  title?: string;
  showHeader?: boolean;
  pageSize?: PageSize;
  onPageSizeChange?: (size: PageSize) => void;
  activeBackendId?: number;
  timeRange?: TimeRange;
  sourceIP?: string;
  sourceChain?: string;
  richExpand?: boolean;
  showProxyColumn?: boolean;
  showProxyTrafficInExpand?: boolean;
  showLastSeenColumn?: boolean;
  mode?: DomainTableMode;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  sortKeyValue?: DomainSortKey;
  sortOrderValue?: SortOrder;
  onSortChange?: (key: DomainSortKey) => void;
  pageValue?: number;
  totalValue?: number;
  onPageChange?: (page: number) => void;
  ruleName?: string;
  contextKey?: string | number;
}

export function DomainStatsTable({
  domains,
  loading = false,
  title,
  showHeader = true,
  pageSize: controlledPageSize,
  onPageSizeChange,
  activeBackendId,
  timeRange,
  sourceIP,
  sourceChain,
  richExpand = false,
  showProxyColumn = true,
  showProxyTrafficInExpand = true,
  showLastSeenColumn = false,
  mode = "local",
  searchValue,
  onSearchChange,
  sortKeyValue,
  sortOrderValue,
  onSortChange,
  pageValue,
  totalValue,
  onPageChange,
  ruleName,
  contextKey,
}: DomainStatsTableProps) {
  const t = useTranslations("domains");
  const detailTimeRange = useStableTimeRange(timeRange);
  const isRemoteMode = mode === "remote";

  const [internalPage, setInternalPage] = useState(1);
  const [internalPageSize, setInternalPageSize] = useState<PageSize>(10);
  const [internalSearch, setInternalSearch] = useState("");
  const [internalSortKey, setInternalSortKey] =
    useState<DomainSortKey>("totalDownload");
  const [internalSortOrder, setInternalSortOrder] = useState<SortOrder>("desc");
  const [expandedDomain, setExpandedDomain] = useState<string | null>(null);
  const [mobileDetailsOpen, setMobileDetailsOpen] = useState(false);
  const [mobileDetailDomain, setMobileDetailDomain] =
    useState<DomainStats | null>(null);

  const pageSize = controlledPageSize ?? internalPageSize;
  const page = isRemoteMode ? pageValue ?? 1 : internalPage;
  const search = isRemoteMode ? searchValue ?? "" : internalSearch;
  const sortKey = isRemoteMode ? sortKeyValue ?? "totalDownload" : internalSortKey;
  const sortOrder = isRemoteMode ? sortOrderValue ?? "desc" : internalSortOrder;
  const detailDomainKey = mobileDetailsOpen
    ? (mobileDetailDomain?.domain ?? null)
    : expandedDomain;

  useEffect(() => {
    // Context switch (backend/device/proxy/rule binding change): collapse.
    setExpandedDomain(null);
    setMobileDetailsOpen(false);
    setMobileDetailDomain(null);
  }, [activeBackendId, sourceIP, sourceChain, richExpand, ruleName, contextKey]);

  useEffect(() => {
    if (!isRemoteMode) {
      setInternalPage(1);
      setInternalSearch("");
      setInternalSortKey("totalDownload");
      setInternalSortOrder("desc");
    }
  }, [contextKey, isRemoteMode]);

  useEffect(() => {
    if (!isRemoteMode) {
      setInternalPage(1);
    }
  }, [pageSize, isRemoteMode]);

  const expandedDomainProxyQuery = useQuery({
    queryKey: getDomainProxyStatsQueryKey(
      detailDomainKey,
      activeBackendId,
      detailTimeRange,
      {
        sourceIP,
        sourceChain,
        rule: ruleName,
      },
    ),
    queryFn: () =>
      ruleName
        ? api.getRuleDomainProxyStats(
            ruleName,
            detailDomainKey!,
            activeBackendId,
            detailTimeRange,
          )
        : api.getDomainProxyStats(
            detailDomainKey!,
            activeBackendId,
            detailTimeRange,
            sourceIP,
            sourceChain,
          ),
    enabled: richExpand && !!activeBackendId && !!detailDomainKey,
    staleTime: DETAIL_QUERY_STALE_MS,
    placeholderData: (previousData, previousQuery) =>
      keepPreviousByIdentity(previousData, previousQuery, {
        domain: detailDomainKey ?? "",
        backendId: activeBackendId ?? null,
        sourceIP: sourceIP ?? "",
        sourceChain: sourceChain ?? "",
        rule: ruleName ?? "",
      }),
  });

  const expandedDomainIPDetailsQuery = useQuery({
    queryKey: getDomainIPDetailsQueryKey(
      detailDomainKey,
      activeBackendId,
      detailTimeRange,
      {
        sourceIP,
        sourceChain,
        rule: ruleName,
      },
    ),
    queryFn: () =>
      ruleName
        ? api.getRuleDomainIPDetails(
            ruleName,
            detailDomainKey!,
            activeBackendId,
            detailTimeRange,
          )
        : api.getDomainIPDetails(
            detailDomainKey!,
            activeBackendId,
            detailTimeRange,
            sourceIP,
            sourceChain,
          ),
    enabled: richExpand && !!activeBackendId && !!detailDomainKey,
    staleTime: DETAIL_QUERY_STALE_MS,
    placeholderData: (previousData, previousQuery) =>
      keepPreviousByIdentity(previousData, previousQuery, {
        domain: detailDomainKey ?? "",
        backendId: activeBackendId ?? null,
        sourceIP: sourceIP ?? "",
        sourceChain: sourceChain ?? "",
        rule: ruleName ?? "",
      }),
  });

  const setEffectivePage = (nextPage: number) => {
    if (isRemoteMode) {
      onPageChange?.(nextPage);
      return;
    }
    setInternalPage(nextPage);
  };

  const setEffectivePageSize = (size: PageSize) => {
    if (onPageSizeChange) {
      onPageSizeChange(size);
    } else {
      setInternalPageSize(size);
    }

    if (isRemoteMode) {
      onPageChange?.(1);
    } else {
      setInternalPage(1);
    }
  };

  const handleSearchInputChange = (value: string) => {
    if (isRemoteMode) {
      onSearchChange?.(value);
      onPageChange?.(1);
      return;
    }
    setInternalSearch(value);
    setInternalPage(1);
  };

  const handleSort = (key: DomainSortKey) => {
    if (isRemoteMode) {
      onSortChange?.(key);
      return;
    }

    if (internalSortKey === key) {
      setInternalSortOrder(internalSortOrder === "asc" ? "desc" : "asc");
    } else {
      setInternalSortKey(key);
      setInternalSortOrder("desc");
    }
    setInternalPage(1);
  };

  const toggleExpand = (domain: string) => {
    const newExpanded = expandedDomain === domain ? null : domain;
    setExpandedDomain(newExpanded);
  };

  const openMobileDetails = (domain: DomainStats) => {
    setMobileDetailDomain(domain);
    setMobileDetailsOpen(true);
  };

  const handleMobileDetailsOpenChange = (open: boolean) => {
    setMobileDetailsOpen(open);
    if (!open) {
      setMobileDetailDomain(null);
    }
  };

  const SortIcon = ({ column }: { column: DomainSortKey }) => {
    if (sortKey !== column) {
      return <ArrowUpDown className="ml-1 h-3 w-3 text-muted-foreground" />;
    }
    return sortOrder === "asc" ? (
      <ArrowUp className="ml-1 h-3 w-3 text-primary" />
    ) : (
      <ArrowDown className="ml-1 h-3 w-3 text-primary" />
    );
  };

  const filteredDomains = useMemo(() => {
    if (isRemoteMode) {
      return domains;
    }

    let result = [...domains];
    if (search) {
      const lower = search.toLowerCase();
      result = result.filter((d) => d.domain.toLowerCase().includes(lower));
    }
    result.sort((a, b) => {
      const aVal = a[sortKey] ?? "";
      const bVal = b[sortKey] ?? "";
      if (sortOrder === "asc") {
        return aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
      }
      return aVal > bVal ? -1 : aVal < bVal ? 1 : 0;
    });
    return result;
  }, [domains, isRemoteMode, search, sortKey, sortOrder]);

  const visibleDomains = useMemo(() => {
    if (isRemoteMode) {
      return domains;
    }
    const start = (page - 1) * pageSize;
    return filteredDomains.slice(start, start + pageSize);
  }, [domains, filteredDomains, isRemoteMode, page, pageSize]);

  const totalItems = isRemoteMode ? totalValue ?? domains.length : filteredDomains.length;
  const totalPages =
    totalItems > 0 ? Math.max(1, Math.ceil(totalItems / pageSize)) : 0;
  const domainColumnClass = showProxyColumn ? "col-span-3" : "col-span-5";
  const uploadColumnClass = showLastSeenColumn ? "col-span-1" : "col-span-2";
  const ipCountColumnClass = "col-span-2";
  const hasRows = visibleDomains.length > 0;
  const startIndex = totalItems === 0 ? 0 : Math.min((page - 1) * pageSize + 1, totalItems);
  const endIndex = Math.min(page * pageSize, totalItems);

  return (
    <Card>
      {showHeader && (
        <div className="p-4 border-b border-border/50">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold">
                {title || t("associatedDomains")}
              </h3>
              <p className="text-sm text-muted-foreground">
                {totalItems} {t("domainsCount")}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative flex-1 sm:flex-none">
                <Input
                  placeholder={t("search")}
                  value={search}
                  onChange={(e) => handleSearchInputChange(e.target.value)}
                  className="h-9 w-full sm:w-[240px] bg-secondary/50 border-0"
                />
              </div>
              {!isRemoteMode && (
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-9 w-9 shrink-0"
                  disabled={filteredDomains.length === 0}
                  aria-label={t("exportDomains")}
                  title={t("exportDomains")}
                  onClick={() =>
                    downloadTextFile(
                      getDomainsExportFilename(ruleName || sourceChain || sourceIP || title || "domains"),
                      filteredDomains.map((item) => item.domain).filter(Boolean),
                    )
                  }>
                  <Download className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      <CardContent className="p-0">
        {loading ? (
          <InsightTableSkeleton />
        ) : !hasRows ? (
          <div className="text-center py-12 text-muted-foreground">
            {search ? t("noResults") : t("noData")}
          </div>
        ) : (
          <>
            <div className="hidden sm:grid grid-cols-12 gap-3 px-5 py-3 bg-secondary/30 text-xs font-medium text-muted-foreground uppercase tracking-wider">
              <div
                className={cn(
                  domainColumnClass,
                  "flex items-center cursor-pointer hover:text-foreground transition-colors",
                )}
                onClick={() => handleSort("domain")}
              >
                {t("domain")}
                <SortIcon column="domain" />
              </div>
              {showProxyColumn && (
                <div className="col-span-2 flex items-center">{t("proxy")}</div>
              )}
              <div
                className="col-span-2 flex items-center justify-end cursor-pointer hover:text-foreground transition-colors"
                onClick={() => handleSort("totalDownload")}
              >
                {t("download")}
                <SortIcon column="totalDownload" />
              </div>
              <div
                className={cn(
                  uploadColumnClass,
                  "flex items-center justify-end cursor-pointer hover:text-foreground transition-colors",
                )}
                onClick={() => handleSort("totalUpload")}
              >
                {t("upload")}
                <SortIcon column="totalUpload" />
              </div>
              <div
                className="col-span-1 flex items-center justify-end cursor-pointer hover:text-foreground transition-colors"
                onClick={() => handleSort("totalConnections")}
              >
                {t("conn")}
                <SortIcon column="totalConnections" />
              </div>
              {showLastSeenColumn && (
                <div className="col-span-1 flex items-center justify-end">
                  {t("last")}
                </div>
              )}
              <div
                className={cn(
                  ipCountColumnClass,
                  "flex items-center justify-end",
                )}
              >
                {t("ipCount")}
              </div>
            </div>

            <div className="sm:hidden flex items-center gap-2 px-4 py-2 bg-secondary/30 overflow-x-auto scrollbar-hide">
              {([
                { key: "domain" as DomainSortKey, label: t("domain") },
                { key: "totalDownload" as DomainSortKey, label: t("download") },
                { key: "totalUpload" as DomainSortKey, label: t("upload") },
                {
                  key: "totalConnections" as DomainSortKey,
                  label: t("conn"),
                },
              ]).map(({ key, label }) => (
                <button
                  key={key}
                  className={cn(
                    "flex items-center gap-0.5 px-2 py-1 rounded-md text-xs font-medium whitespace-nowrap transition-colors",
                    sortKey === key
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                  onClick={() => handleSort(key)}
                >
                  {label}
                  {sortKey === key &&
                    (sortOrder === "asc" ? (
                      <ArrowUp className="h-3 w-3" />
                    ) : (
                      <ArrowDown className="h-3 w-3" />
                    ))}
                </button>
              ))}
            </div>

            <div className="divide-y divide-border/30">
              {visibleDomains.map((domain, index) => {
                const isDesktopExpanded = expandedDomain === domain.domain;
                const isMobileActive =
                  mobileDetailsOpen && mobileDetailDomain?.domain === domain.domain;

                return (
                  <div key={domain.domain} className="group">
                    <div
                      className={cn(
                        "hidden sm:grid grid-cols-12 gap-3 px-5 py-4 items-center hover:bg-secondary/20 transition-colors cursor-pointer",
                        isDesktopExpanded && "bg-secondary/10",
                      )}
                      style={{ animationDelay: `${index * 50}ms` }}
                      onClick={() => toggleExpand(domain.domain)}
                    >
                      <div className={cn(domainColumnClass, "flex items-center gap-3 min-w-0")}>
                        <Favicon domain={domain.domain} size="sm" className="shrink-0" />
                        <DomainPreview
                          className="flex-1"
                          domain={domain.domain}
                          unknownLabel={t("unknown")}
                          copyLabel={t("copyDomain")}
                          copiedLabel={t("copied")}
                        />
                      </div>

                      {showProxyColumn && (
                        <div className="col-span-2 flex items-center gap-1.5 min-w-0">
                          <ProxyChainBadge chains={domain.chains} />
                        </div>
                      )}

                      <div className="col-span-2 text-right tabular-nums text-sm whitespace-nowrap">
                        <span className="text-blue-500">{formatBytes(domain.totalDownload)}</span>
                      </div>

                      <div
                        className={cn(
                          uploadColumnClass,
                          "text-right tabular-nums text-sm whitespace-nowrap",
                        )}
                      >
                        <span className="text-purple-500">{formatBytes(domain.totalUpload)}</span>
                      </div>

                      <div className="col-span-1 flex items-center justify-end">
                        <span className="px-2 py-0.5 rounded-full bg-secondary text-xs font-medium">
                          {formatNumber(domain.totalConnections)}
                        </span>
                      </div>

                      {showLastSeenColumn && (
                        <div className="col-span-1 text-right">
                          <p className="text-xs text-muted-foreground">
                            {formatDuration(domain.lastSeen)}
                          </p>
                        </div>
                      )}

                      <div
                        className={cn(
                          ipCountColumnClass,
                          "flex items-center justify-end",
                        )}
                      >
                        <Button
                          variant="ghost"
                          size="sm"
                          className={cn(
                            "h-7 px-2 gap-1 text-xs font-medium transition-all",
                            isDesktopExpanded
                              ? "bg-primary/10 text-primary hover:bg-primary/20"
                              : "bg-secondary/50 text-muted-foreground hover:text-foreground hover:bg-secondary",
                          )}
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleExpand(domain.domain);
                          }}
                        >
                          <Server className="h-3 w-3" />
                          {domain.ips?.length || 0}
                          {isDesktopExpanded ? (
                            <ChevronUp className="h-3 w-3 ml-0.5" />
                          ) : (
                            <ChevronDown className="h-3 w-3 ml-0.5" />
                          )}
                        </Button>
                      </div>
                    </div>

                    <div
                      className={cn(
                        "sm:hidden px-4 py-3 hover:bg-secondary/20 transition-colors cursor-pointer",
                        isMobileActive && "bg-secondary/10",
                      )}
                      onClick={() => openMobileDetails(domain)}
                    >
                      <div className="flex items-center gap-2.5 mb-2">
                        <Favicon domain={domain.domain} size="sm" className="shrink-0" />
                        <DomainPreview
                          className="flex-1"
                          domain={domain.domain}
                          unknownLabel={t("unknown")}
                          copyLabel={t("copyDomain")}
                          copiedLabel={t("copied")}
                          interactive={false}
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          className={cn(
                            "h-7 px-2 gap-1 text-xs font-medium shrink-0",
                            isMobileActive
                              ? "bg-primary/10 text-primary"
                              : "bg-secondary/50 text-muted-foreground",
                          )}
                          onClick={(e) => {
                            e.stopPropagation();
                            openMobileDetails(domain);
                          }}
                        >
                          <Server className="h-3 w-3" />
                          {domain.ips?.length || 0}
                          {isMobileActive ? (
                            <ChevronUp className="h-3 w-3" />
                          ) : (
                            <ChevronDown className="h-3 w-3" />
                          )}
                        </Button>
                      </div>

                      {showProxyColumn && domain.chains && domain.chains.length > 0 && (
                        <div className="flex items-center gap-1.5 mb-2 pl-[30px]">
                          <ProxyChainBadge
                            chains={domain.chains}
                            truncateLabel={false}
                            interactive={false}
                          />
                        </div>
                      )}

                      <div className="flex items-center justify-between text-xs pl-[30px]">
                        <span className="text-blue-500 tabular-nums whitespace-nowrap">
                          ↓ {formatBytes(domain.totalDownload)}
                        </span>
                        <span className="text-purple-500 tabular-nums whitespace-nowrap">
                          ↑ {formatBytes(domain.totalUpload)}
                        </span>
                        <span className="px-2 py-0.5 rounded-full bg-secondary text-muted-foreground font-medium">
                          {formatNumber(domain.totalConnections)} {t("conn")}
                        </span>
                      </div>
                    </div>

                    {isDesktopExpanded && (
                      <div className="hidden sm:block">
                        <ExpandReveal>
                          <DomainExpandedDetails
                            domain={domain}
                            richExpand={richExpand}
                            proxyStats={expandedDomainProxyQuery.data ?? []}
                            proxyStatsLoading={
                              expandedDomainProxyQuery.isLoading &&
                              !expandedDomainProxyQuery.data
                            }
                            ipDetails={expandedDomainIPDetailsQuery.data ?? []}
                            ipDetailsLoading={
                              expandedDomainIPDetailsQuery.isLoading &&
                              !expandedDomainIPDetailsQuery.data
                            }
                            labels={{
                              proxyTraffic: t("proxyTraffic"),
                              associatedIPs: t("associatedIPs"),
                              conn: t("conn"),
                            }}
                            showProxyTraffic={showProxyTrafficInExpand}
                          />
                        </ExpandReveal>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <Drawer open={mobileDetailsOpen} onOpenChange={handleMobileDetailsOpenChange}>
              <DrawerContent className="sm:hidden">
                <DrawerHeader className="border-b border-border/60 bg-background/95 px-5 pt-2 pb-2.5">
                  <div className="flex items-center gap-2.5 min-w-0 rounded-md border border-border/60 bg-muted/25 px-2.5 py-2">
                    <Favicon domain={mobileDetailDomain?.domain || ""} size="sm" className="shrink-0" />
                    <div className="min-w-0 flex-1">
                      <DrawerTitle className="text-left text-[15px] font-semibold leading-5 break-all">
                        {mobileDetailDomain?.domain || t("unknown")}
                      </DrawerTitle>
                    </div>
                    <CopyIconButton
                      value={mobileDetailDomain?.domain || ""}
                      copyLabel={t("copyDomain")}
                      copiedLabel={t("copied")}
                      disabled={!mobileDetailDomain?.domain}
                    />
                  </div>
                </DrawerHeader>
                <div className="max-h-[76vh] overflow-y-auto pb-[max(env(safe-area-inset-bottom),0px)]">
                  {mobileDetailDomain ? (
                    <DomainExpandedDetails
                      domain={mobileDetailDomain}
                      richExpand={richExpand}
                      proxyStats={expandedDomainProxyQuery.data ?? []}
                      proxyStatsLoading={
                        expandedDomainProxyQuery.isLoading &&
                        !expandedDomainProxyQuery.data
                      }
                      ipDetails={expandedDomainIPDetailsQuery.data ?? []}
                      ipDetailsLoading={
                        expandedDomainIPDetailsQuery.isLoading &&
                        !expandedDomainIPDetailsQuery.data
                      }
                      labels={{
                        proxyTraffic: t("proxyTraffic"),
                        associatedIPs: t("associatedIPs"),
                        conn: t("conn"),
                      }}
                      showProxyTraffic={showProxyTrafficInExpand}
                      showFullProxyChains
                    />
                  ) : null}
                </div>
              </DrawerContent>
            </Drawer>

            {totalItems > 0 && (
              <div className="p-3 border-t border-border/50 bg-secondary/20">
                <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 gap-1.5 text-muted-foreground hover:text-foreground"
                        >
                          <Rows3 className="h-4 w-4" />
                          <span>{pageSize} / {t("page")}</span>
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start">
                        {PAGE_SIZE_OPTIONS.map((size) => (
                          <DropdownMenuItem
                            key={size}
                            onClick={() => setEffectivePageSize(size)}
                            className={pageSize === size ? "bg-primary/10" : ""}
                          >
                            {size} / {t("page")}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  <div className="flex flex-col sm:flex-row items-center gap-1 sm:gap-2">
                    <p className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
                      {startIndex}-{endIndex} / {totalItems}
                    </p>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => setEffectivePage(Math.max(1, page - 1))}
                        disabled={page <= 1}
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                      {getPageNumbers(page, totalPages).map((p, idx) =>
                        p === "..." ? (
                          <span key={`ellipsis-${idx}`} className="px-1 text-muted-foreground text-xs">
                            ...
                          </span>
                        ) : (
                          <Button
                            key={p}
                            variant={page === p ? "default" : "ghost"}
                            size="sm"
                            className="h-8 w-8 px-0 text-xs"
                            onClick={() => setEffectivePage(p as number)}
                          >
                            {p}
                          </Button>
                        ),
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => setEffectivePage(Math.min(totalPages, page + 1))}
                        disabled={page >= totalPages}
                      >
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

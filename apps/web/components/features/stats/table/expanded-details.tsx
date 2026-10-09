"use client";

import { Building2, Download, Globe, Link2, Loader2, MapPin, Network, Server, Waypoints } from "lucide-react";
import { useTranslations } from "next-intl";
import { CountryFlag } from "@/components/features/countries";
import { Favicon } from "@/components/common";
import { DomainPreview } from "@/components/features/domains";
import { Button } from "@/components/ui/button";
import { downloadTextFile, getDomainsExportFilename } from "@/lib/download-text-file";
import { getDomainColor, getIPGradient } from "@/lib/stats-utils";
import { formatBytes, formatNumber } from "@/lib/utils";
import { useCountryName } from "@/lib/i18n-country";
import { normalizeGeoIP } from "@neko-master/shared";
import type { DomainStats, IPStats, ProxyTrafficStats } from "@neko-master/shared";

interface DomainExpandedDetailsProps {
  domain: Pick<
    DomainStats,
    "domain" | "ips" | "chains" | "totalDownload" | "totalUpload"
  >;
  richExpand?: boolean;
  proxyStats?: ProxyTrafficStats[];
  proxyStatsLoading?: boolean;
  ipDetails?: IPStats[];
  ipDetailsLoading?: boolean;
  labels: {
    proxyTraffic: string;
    associatedIPs: string;
    conn: string;
  };
  showProxyTraffic?: boolean;
  showFullProxyChains?: boolean;
}

interface IPExpandedDetailsProps {
  ip: Pick<
    IPStats,
    "ip" | "domains" | "chains" | "totalDownload" | "totalUpload" | "asn" | "geoIP"
  >;
  richExpand?: boolean;
  proxyStats?: ProxyTrafficStats[];
  proxyStatsLoading?: boolean;
  domainDetails?: DomainStats[];
  domainDetailsLoading?: boolean;
  labels: {
    proxyTraffic: string;
    associatedDomains: string;
    conn: string;
  };
  associatedDomainsIcon?: "link" | "globe";
  showProxyTraffic?: boolean;
  showFullProxyChains?: boolean;
  disableNestedInteractions?: boolean;
  showIPLookupDetails?: boolean;
}

function getLandingProxy(chain: string): string {
  const parts = chain
    .split(">")
    .map((part) => part.trim())
    .filter(Boolean);
  return parts[0] || chain;
}

function getDisplayChain(chain: string): string {
  const parts = chain
    .split(">")
    .map((part) => part.trim())
    .filter(Boolean);
  const displayParts = parts.length > 1 ? [...parts].reverse() : parts;
  return displayParts.join(" -> ");
}

function LoadingBlock() {
  return (
    <div className="flex items-center justify-center py-4">
      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
    </div>
  );
}

const MAX_ASSOCIATED_PLACEHOLDERS = 12;

function AssociatedLoadingList({ count }: { count: number }) {
  const safeCount = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  const renderCount = safeCount > 0 ? Math.min(safeCount, MAX_ASSOCIATED_PLACEHOLDERS) : 3;
  const remaining = safeCount > renderCount ? safeCount - renderCount : 0;

  return (
    <div className="space-y-2">
      {Array.from({ length: renderCount }).map((_, index) => (
        <div
          key={`placeholder-${index}`}
          className="px-3 py-2 rounded-lg bg-card border border-border/50 animate-pulse"
        >
          <div className="flex items-center justify-between mb-2">
            <div className="h-3.5 w-28 rounded bg-secondary/80" />
            <div className="h-3 w-10 rounded bg-secondary/70" />
          </div>
          <div className="h-1.5 w-full rounded-full bg-secondary/70 mb-2" />
          <div className="flex items-center gap-2">
            <div className="h-3 w-16 rounded bg-secondary/70" />
            <div className="h-3 w-14 rounded bg-secondary/70" />
            <div className="h-3 w-12 rounded bg-secondary/70" />
          </div>
        </div>
      ))}
      {remaining > 0 && (
        <div className="px-1 pt-1 text-[11px] text-muted-foreground tabular-nums">
          +{remaining}
        </div>
      )}
    </div>
  );
}

function TrafficBar({
  percent,
  downloadPercent,
  uploadPercent,
}: {
  percent: number;
  downloadPercent: number;
  uploadPercent: number;
}) {
  return (
    <div className="w-full h-1.5 rounded-full bg-secondary/80 mb-1.5 overflow-hidden flex">
      <div
        className="h-full bg-blue-500 transition-all"
        style={{ width: `${Math.max(percent * (downloadPercent / 100), 0.5)}%` }}
      />
      <div
        className="h-full bg-purple-500 transition-all"
        style={{ width: `${Math.max(percent * (uploadPercent / 100), 0.5)}%` }}
      />
    </div>
  );
}

function ProxyFallbackChains({
  chains,
  showFullProxyChains = false,
}: {
  chains: string[];
  showFullProxyChains?: boolean;
}) {
  if (!chains.length) {
    return <span className="text-xs text-muted-foreground">-</span>;
  }

  if (showFullProxyChains) {
    return (
      <div className="space-y-2">
        {chains.map((chain, idx) => (
          <div
            key={`${chain}-${idx}`}
            className="px-3 py-2 rounded-lg bg-card border border-border/50"
          >
            <span className="inline-flex items-start gap-1.5 text-xs font-medium text-foreground/90">
              <Waypoints className="mt-0.5 h-3 w-3 text-orange-500 shrink-0" />
              <code className="break-all leading-5">{getDisplayChain(chain)}</code>
            </span>
          </div>
        ))}
      </div>
    );
  }

  const proxies = Array.from(new Set(chains.map(getLandingProxy).filter(Boolean)));

  return (
    <div className="flex flex-wrap gap-1.5">
      {proxies.map((proxy) => (
        <span
          key={proxy}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-secondary/60 text-foreground dark:bg-secondary/40 dark:text-foreground/80 text-xs font-medium max-w-full min-w-0"
          title={proxy}
        >
          <Waypoints className="h-3 w-3 shrink-0" />
          <span className="truncate min-w-0">{proxy}</span>
        </span>
      ))}
    </div>
  );
}

function ProxyTrafficCards({
  proxyStats,
  totalDownload,
  totalUpload,
  connLabel,
  showFullProxyChains = false,
}: {
  proxyStats: ProxyTrafficStats[];
  totalDownload: number;
  totalUpload: number;
  connLabel: string;
  showFullProxyChains?: boolean;
}) {
  const mergedStats = showFullProxyChains
    ? [...proxyStats].sort(
        (a, b) =>
          b.totalDownload + b.totalUpload - (a.totalDownload + a.totalUpload),
      )
    : (() => {
        const grouped = new Map<string, ProxyTrafficStats>();
        for (const stat of proxyStats) {
          const proxy = getLandingProxy(stat.chain);
          const prev = grouped.get(proxy);
          if (prev) {
            prev.totalDownload += stat.totalDownload;
            prev.totalUpload += stat.totalUpload;
            prev.totalConnections += stat.totalConnections;
          } else {
            grouped.set(proxy, {
              chain: proxy,
              totalDownload: stat.totalDownload,
              totalUpload: stat.totalUpload,
              totalConnections: stat.totalConnections,
            });
          }
        }
        return Array.from(grouped.values()).sort(
          (a, b) =>
            b.totalDownload + b.totalUpload - (a.totalDownload + a.totalUpload),
        );
      })();

  const totalTraffic = totalDownload + totalUpload;
  return (
    <div className="space-y-2">
      {mergedStats.map((ps, idx) => {
        const proxyTraffic = ps.totalDownload + ps.totalUpload;
        const percent = totalTraffic > 0 ? (proxyTraffic / totalTraffic) * 100 : 0;
        const proxyTotal = ps.totalDownload + ps.totalUpload;
        const downloadPercent = proxyTotal > 0 ? (ps.totalDownload / proxyTotal) * 100 : 0;
        const uploadPercent = proxyTotal > 0 ? (ps.totalUpload / proxyTotal) * 100 : 0;
        const chainLabel = showFullProxyChains ? getDisplayChain(ps.chain) : ps.chain;

        return (
          <div key={`${ps.chain}-${idx}`} className="px-3 py-2 rounded-lg bg-card border border-border/50">
            <div className="flex items-center justify-between mb-1.5">
              <span className="inline-flex items-start gap-1.5 text-xs font-medium min-w-0 max-w-[72%]">
                <Waypoints className="mt-0.5 h-3 w-3 text-orange-500 shrink-0" />
                <span
                  className={showFullProxyChains ? "break-all leading-5" : "truncate"}
                  title={chainLabel}
                >
                  {chainLabel}
                </span>
              </span>
              <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">
                {percent.toFixed(1)}%
              </span>
            </div>
            <TrafficBar
              percent={percent}
              downloadPercent={downloadPercent}
              uploadPercent={uploadPercent}
            />
            <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-[11px] tabular-nums">
              <span className="text-blue-500">↓ {formatBytes(ps.totalDownload)}</span>
              <span className="text-purple-500">↑ {formatBytes(ps.totalUpload)}</span>
              <span className="inline-flex items-center gap-1 text-muted-foreground">
                <Link2 className="h-3 w-3" />
                {formatNumber(ps.totalConnections)}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function IPFallbackChips({ ips }: { ips: string[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {ips.map((ip) => {
        const gradient = getIPGradient(ip);
        return (
          <div
            key={ip}
            className="flex items-center gap-2 px-2.5 py-1.5 sm:px-3 sm:py-2 rounded-lg bg-card border border-border/50 hover:border-primary/30 hover:shadow-sm transition-all"
          >
            <div
              className={`w-5 h-5 sm:w-6 sm:h-6 rounded-md bg-gradient-to-br ${gradient} flex items-center justify-center shrink-0`}
            >
              <Server className="w-2.5 h-2.5 sm:w-3 sm:h-3 text-white" />
            </div>
            <code className="text-xs font-mono break-all">{ip}</code>
          </div>
        );
      })}
    </div>
  );
}

function DomainFallbackChips({ domains }: { domains: string[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {domains.map((domain) => {
        const domainColor = getDomainColor(domain);
        return (
          <div
            key={domain}
            className="flex items-center gap-2 px-2.5 py-1.5 sm:px-3 sm:py-2 rounded-lg bg-card border border-border/50 hover:border-primary/30 hover:shadow-sm transition-all"
          >
            <div
              className={`w-5 h-5 sm:w-6 sm:h-6 rounded-md ${domainColor.bg} ${domainColor.text} flex items-center justify-center shrink-0`}
            >
              <Globe className="w-2.5 h-2.5 sm:w-3 sm:h-3" />
            </div>
            <span className="text-xs font-medium truncate max-w-[180px] sm:max-w-[200px]">
              {domain}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function ExportDomainsButton({ entityName, domains }: { entityName: string; domains: string[] }) {
  const t = useTranslations("domains");

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      className="ml-auto h-7 w-7 text-muted-foreground hover:text-foreground hover:bg-muted/60 dark:text-muted-foreground dark:hover:text-foreground dark:hover:bg-muted/60"
      aria-label={t("exportDomains")}
      title={t("exportDomains")}
      disabled={domains.length === 0}
      onClick={(event) => {
        event.stopPropagation();
        downloadTextFile(getDomainsExportFilename(entityName), domains);
      }}
    >
      <Download className="size-3" />
    </Button>
  );
}

export function DomainExpandedDetails({
  domain,
  richExpand = true,
  proxyStats = [],
  proxyStatsLoading = false,
  ipDetails = [],
  ipDetailsLoading = false,
  labels,
  showProxyTraffic = true,
  showFullProxyChains = false,
}: DomainExpandedDetailsProps) {
  const localizedName = useCountryName();

  if (!richExpand) {
    return (
      <div className="px-4 sm:px-5 pb-4 bg-secondary/5">
        <div className="pt-3">
          <div className="px-1">
            <p className="text-xs font-medium text-muted-foreground mb-2.5 flex items-center gap-1.5">
              <Globe className="h-3 w-3" />
              {labels.associatedIPs}
            </p>
            <IPFallbackChips ips={domain.ips || []} />
          </div>
        </div>
      </div>
    );
  }

  const totalIPTraffic = ipDetails.reduce((sum, ip) => sum + ip.totalDownload + ip.totalUpload, 0);

  return (
    <div className="px-4 sm:px-5 pb-4 bg-secondary/5">
      <div className={showProxyTraffic ? "pt-3 grid grid-cols-1 sm:grid-cols-2 gap-4" : "pt-3"}>
        {showProxyTraffic && (
          <div className="px-1">
            <p className="text-xs font-medium text-muted-foreground mb-2.5 flex items-center gap-1.5">
              <Waypoints className="h-3 w-3" />
              {labels.proxyTraffic}
            </p>
            {proxyStatsLoading ? (
              <LoadingBlock />
            ) : proxyStats.length > 0 ? (
              <ProxyTrafficCards
                proxyStats={proxyStats}
                totalDownload={domain.totalDownload}
                totalUpload={domain.totalUpload}
                connLabel={labels.conn}
                showFullProxyChains={showFullProxyChains}
              />
            ) : (
              <ProxyFallbackChains
                chains={domain.chains || []}
                showFullProxyChains={showFullProxyChains}
              />
            )}
          </div>
        )}

        <div className="px-1">
          <p className="text-xs font-medium text-muted-foreground mb-2.5 flex items-center gap-1.5">
            <Globe className="h-3 w-3" />
            {labels.associatedIPs}
          </p>
          {ipDetailsLoading ? (
            <AssociatedLoadingList count={domain.ips?.length ?? 0} />
          ) : ipDetails.length > 0 ? (
            <div className="space-y-2">
              {ipDetails.map((ipStat) => {
                const geo = normalizeGeoIP(ipStat.geoIP);
                const country = geo?.countryCode;
                const location = geo?.countryCode ? localizedName(geo.countryCode) : null;
                const ipTraffic = ipStat.totalDownload + ipStat.totalUpload;
                const percent = totalIPTraffic > 0 ? (ipTraffic / totalIPTraffic) * 100 : 0;
                const downloadPercent = ipTraffic > 0 ? (ipStat.totalDownload / ipTraffic) * 100 : 0;
                const uploadPercent = ipTraffic > 0 ? (ipStat.totalUpload / ipTraffic) * 100 : 0;

                return (
                  <div
                    key={ipStat.ip}
                    className="px-3 py-2 rounded-lg bg-card border border-border/50 hover:border-primary/30 hover:shadow-sm transition-all"
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-1.5">
                        <Waypoints className="h-3 w-3 text-orange-500 shrink-0" />
                        <code className="text-xs font-mono">{ipStat.ip}</code>
                      </div>
                      <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">
                        {percent.toFixed(1)}%
                      </span>
                    </div>
                    <TrafficBar
                      percent={percent}
                      downloadPercent={downloadPercent}
                      uploadPercent={uploadPercent}
                    />
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 sm:gap-0">
                      <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-[11px] tabular-nums">
                        <span className="text-blue-500">↓ {formatBytes(ipStat.totalDownload)}</span>
                        <span className="text-purple-500">↑ {formatBytes(ipStat.totalUpload)}</span>
                        <span className="inline-flex items-center gap-1 text-muted-foreground">
                          <Link2 className="h-3 w-3" />
                          {formatNumber(ipStat.totalConnections)}
                        </span>
                      </div>
                      {location && (
                        <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                          <CountryFlag country={country} className="h-3 w-4" />
                          <span>{location}</span>
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <IPFallbackChips ips={domain.ips || []} />
          )}
        </div>
      </div>
    </div>
  );
}

export function IPExpandedDetails({
  ip,
  richExpand = true,
  proxyStats = [],
  proxyStatsLoading = false,
  domainDetails = [],
  domainDetailsLoading = false,
  labels,
  associatedDomainsIcon = "link",
  showProxyTraffic = true,
  showFullProxyChains = false,
  disableNestedInteractions = false,
  showIPLookupDetails = false,
}: IPExpandedDetailsProps) {
  const AssociatedDomainsTitleIcon = associatedDomainsIcon === "globe" ? Globe : Link2;
  const domainsT = useTranslations("domains");
  const ipsT = useTranslations("ips");
  const localizedName = useCountryName();
  const associatedDomains = !richExpand
    ? ip.domains || []
    : domainDetailsLoading
      ? []
      : domainDetails.length > 0
        ? domainDetails.map((domain) => domain.domain)
        : ip.domains || [];

  const geo = normalizeGeoIP(ip.geoIP);
  const countryCode = geo?.countryCode;
  const city = geo?.city || ipsT("unknown");
  const asOrganization = geo?.asOrganization || ipsT("unknown");
  const asnValue = ip.asn || ipsT("unknown");
  const hasLocation = Boolean(countryCode);
  const displayLocation = countryCode ? localizedName(countryCode) : ipsT("unknown");

  const ipLookupDetails = showIPLookupDetails ? (
    <div className="px-1">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div className="px-3 py-2 rounded-lg bg-card border border-border/50">
          <p className="inline-flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            <MapPin className="h-3 w-3" />
            {ipsT("location")}
          </p>
          {hasLocation ? (
            <span className="mt-1.5 flex min-w-0 items-center gap-1.5">
              <CountryFlag country={countryCode || "UN"} className="h-3.5 w-5" />
              <span className="truncate text-sm font-medium leading-5">{displayLocation}</span>
            </span>
          ) : (
            <span className="mt-1.5 block truncate text-sm leading-5 text-muted-foreground">
              {ipsT("unknown")}
            </span>
          )}
        </div>

        <div className="px-3 py-2 rounded-lg bg-card border border-border/50">
          <p className="inline-flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            <Building2 className="h-3 w-3" />
            {ipsT("city")}
          </p>
          <span title={city} className="mt-1.5 block truncate text-sm font-medium leading-5">
            {city}
          </span>
        </div>

        <div className="px-3 py-2 rounded-lg bg-card border border-border/50">
          <p className="inline-flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            <Network className="h-3 w-3" />
            {ipsT("asn")}
          </p>
          <span className="mt-1.5 block truncate text-sm font-semibold tabular-nums leading-5">
            {asnValue}
          </span>
        </div>

        <div className="px-3 py-2 rounded-lg bg-card border border-border/50">
          <p className="inline-flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            <Server className="h-3 w-3" />
            {ipsT("asOrganization")}
          </p>
          <span
            title={asOrganization}
            className="mt-1.5 block truncate text-sm font-medium leading-5"
          >
            {asOrganization}
          </span>
        </div>
      </div>
    </div>
  ) : null;

  if (!richExpand) {
    return (
      <div className="px-4 sm:px-5 pb-4 bg-secondary/5">
        <div className="pt-3 space-y-3">
          {ipLookupDetails}
          <div className="px-1">
            <p className="text-xs font-medium text-muted-foreground mb-2.5 flex items-center gap-1.5">
              <AssociatedDomainsTitleIcon className="h-3 w-3" />
              {labels.associatedDomains}
              <ExportDomainsButton entityName={ip.ip} domains={associatedDomains} />
            </p>
            <DomainFallbackChips domains={ip.domains || []} />
          </div>
        </div>
      </div>
    );
  }

  const totalDomainTraffic = domainDetails.reduce(
    (sum, domain) => sum + domain.totalDownload + domain.totalUpload,
    0,
  );

  return (
    <div className="px-4 sm:px-5 pb-4 bg-secondary/5">
      <div className="pt-3 space-y-3">
        {ipLookupDetails}

        <div className={showProxyTraffic ? "grid grid-cols-1 sm:grid-cols-2 gap-4" : ""}>
        {showProxyTraffic && (
          <div className="px-1">
            <p className="text-xs font-medium text-muted-foreground mb-2.5 flex items-center gap-1.5">
              <Waypoints className="h-3 w-3" />
              {labels.proxyTraffic}
            </p>
            {proxyStatsLoading ? (
              <LoadingBlock />
            ) : proxyStats.length > 0 ? (
              <ProxyTrafficCards
                proxyStats={proxyStats}
                totalDownload={ip.totalDownload}
                totalUpload={ip.totalUpload}
                connLabel={labels.conn}
                showFullProxyChains={showFullProxyChains}
              />
            ) : (
              <ProxyFallbackChains
                chains={ip.chains || []}
                showFullProxyChains={showFullProxyChains}
              />
            )}
          </div>
        )}

        <div className="px-1">
          <p className="text-xs font-medium text-muted-foreground mb-2.5 flex items-center gap-1.5">
            <AssociatedDomainsTitleIcon className="h-3 w-3" />
            {labels.associatedDomains}
            <ExportDomainsButton entityName={ip.ip} domains={associatedDomains} />
          </p>
          {domainDetailsLoading ? (
            <AssociatedLoadingList count={ip.domains?.length ?? 0} />
          ) : domainDetails.length > 0 ? (
            <div className="space-y-2">
              {domainDetails.map((domain) => {
                const domainTraffic = domain.totalDownload + domain.totalUpload;
                const percent =
                  totalDomainTraffic > 0 ? (domainTraffic / totalDomainTraffic) * 100 : 0;
                const downloadPercent =
                  domainTraffic > 0 ? (domain.totalDownload / domainTraffic) * 100 : 0;
                const uploadPercent =
                  domainTraffic > 0 ? (domain.totalUpload / domainTraffic) * 100 : 0;

                return (
                  <div
                    key={domain.domain}
                    className="px-3 py-2 rounded-lg bg-card border border-border/50 hover:border-primary/30 hover:shadow-sm transition-all"
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <Favicon domain={domain.domain} size="sm" className="shrink-0" />
                        <DomainPreview
                          className="flex-1"
                          triggerClassName="text-xs"
                          domain={domain.domain}
                          unknownLabel={domainsT("unknown")}
                          copyLabel={domainsT("copyDomain")}
                          copiedLabel={domainsT("copied")}
                          interactive={!disableNestedInteractions}
                        />
                      </div>
                      <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">
                        {percent.toFixed(1)}%
                      </span>
                    </div>
                    <TrafficBar
                      percent={percent}
                      downloadPercent={downloadPercent}
                      uploadPercent={uploadPercent}
                    />
                    <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-[11px] tabular-nums">
                      <span className="text-blue-500">↓ {formatBytes(domain.totalDownload)}</span>
                      <span className="text-purple-500">↑ {formatBytes(domain.totalUpload)}</span>
                      <span className="inline-flex items-center gap-1 text-muted-foreground">
                        <Link2 className="h-3 w-3" />
                        {formatNumber(domain.totalConnections)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <DomainFallbackChips domains={ip.domains || []} />
          )}
        </div>
      </div>
      </div>
    </div>
  );
}

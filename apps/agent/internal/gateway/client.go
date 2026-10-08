package gateway

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/foru17/neko-master/apps/agent/internal/domain"
)

var (
	domainPattern   = regexp.MustCompile(`^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$`)
	policyPathRegex = regexp.MustCompile(`\[Rule\] Policy decision path: (.+)`)
)

type Client struct {
	httpClient  *http.Client
	gatewayType string
	endpoint    string
	token       string
}

func NewClient(httpClient *http.Client, gatewayType, endpoint, token string) *Client {
	return &Client{
		httpClient:  httpClient,
		gatewayType: gatewayType,
		endpoint:    endpoint,
		token:       token,
	}
}

func (c *Client) Collect(ctx context.Context) ([]domain.FlowSnapshot, error) {
	if c.gatewayType == "clash" {
		return c.collectClash(ctx)
	}
	return c.collectSurge(ctx)
}

type clashConnectionsResponse struct {
	Connections []struct {
		ID          string   `json:"id"`
		Start       string   `json:"start"`
		Upload      float64  `json:"upload"`
		Download    float64  `json:"download"`
		Rule        string   `json:"rule"`
		RulePayload string   `json:"rulePayload"`
		Chains      []string `json:"chains"`
		Metadata    struct {
			Host          string `json:"host"`
			SniffHost     string `json:"sniffHost"`
			DestinationIP string `json:"destinationIP"`
			SourceIP      string `json:"sourceIP"`
		} `json:"metadata"`
	} `json:"connections"`
}

type flexibleID string

func (v *flexibleID) UnmarshalJSON(data []byte) error {
	trimmed := bytes.TrimSpace(data)
	if len(trimmed) == 0 || bytes.Equal(trimmed, []byte("null")) {
		*v = ""
		return nil
	}

	var strVal string
	if err := json.Unmarshal(trimmed, &strVal); err == nil {
		*v = flexibleID(strVal)
		return nil
	}

	var numVal json.Number
	if err := json.Unmarshal(trimmed, &numVal); err == nil {
		*v = flexibleID(numVal.String())
		return nil
	}

	return fmt.Errorf("unsupported id value: %s", string(trimmed))
}

type flexibleFloat64 float64

func (v *flexibleFloat64) UnmarshalJSON(data []byte) error {
	trimmed := bytes.TrimSpace(data)
	if len(trimmed) == 0 || bytes.Equal(trimmed, []byte("null")) {
		*v = 0
		return nil
	}

	var numVal json.Number
	if err := json.Unmarshal(trimmed, &numVal); err == nil {
		f, err := numVal.Float64()
		if err != nil {
			return fmt.Errorf("invalid numeric value: %s", string(trimmed))
		}
		*v = flexibleFloat64(f)
		return nil
	}

	var strVal string
	if err := json.Unmarshal(trimmed, &strVal); err == nil {
		strVal = strings.TrimSpace(strVal)
		if strVal == "" {
			*v = 0
			return nil
		}
		f, err := json.Number(strVal).Float64()
		if err != nil {
			return fmt.Errorf("invalid numeric string: %q", strVal)
		}
		*v = flexibleFloat64(f)
		return nil
	}

	return fmt.Errorf("unsupported numeric value: %s", string(trimmed))
}

type flexibleStringList []string

func (v *flexibleStringList) UnmarshalJSON(data []byte) error {
	trimmed := bytes.TrimSpace(data)
	if len(trimmed) == 0 || bytes.Equal(trimmed, []byte("null")) {
		*v = nil
		return nil
	}

	var list []string
	if err := json.Unmarshal(trimmed, &list); err == nil {
		*v = list
		return nil
	}

	var single string
	if err := json.Unmarshal(trimmed, &single); err == nil {
		single = strings.TrimSpace(single)
		if single == "" {
			*v = nil
			return nil
		}
		*v = []string{single}
		return nil
	}

	return fmt.Errorf("unsupported notes value: %s", string(trimmed))
}

type surgeRequestsResponse struct {
	Requests []struct {
		ID                 flexibleID         `json:"id"`
		RemoteHost         string             `json:"remoteHost"`
		RemoteAddress      string             `json:"remoteAddress"`
		LocalAddress       string             `json:"localAddress"`
		SourceAddress      string             `json:"sourceAddress"`
		PolicyName         string             `json:"policyName"`
		OriginalPolicyName string             `json:"originalPolicyName"`
		Rule               string             `json:"rule"`
		Notes              flexibleStringList `json:"notes"`
		OutBytes           flexibleFloat64    `json:"outBytes"`
		InBytes            flexibleFloat64    `json:"inBytes"`
		Time               flexibleFloat64    `json:"time"`
		StartDate          flexibleFloat64    `json:"startDate"`
	} `json:"requests"`
}

func (c *Client) collectClash(ctx context.Context) ([]domain.FlowSnapshot, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.endpoint+"/connections", nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	if c.token != "" {
		req.Header.Set("Authorization", "Bearer "+c.token)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return nil, fmt.Errorf("gateway http %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	var payload clashConnectionsResponse
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return nil, fmt.Errorf("decode clash response: %w", err)
	}

	nowMs := time.Now().UnixMilli()
	snapshots := make([]domain.FlowSnapshot, 0, len(payload.Connections))
	for _, item := range payload.Connections {
		id := strings.TrimSpace(item.ID)
		if id == "" {
			continue
		}
		domainName := strings.TrimSpace(item.Metadata.Host)
		if domainName == "" {
			domainName = strings.TrimSpace(item.Metadata.SniffHost)
		}
		snapshots = append(snapshots, domain.FlowSnapshot{
			ID:          id,
			Domain:      domainName,
			IP:          strings.TrimSpace(item.Metadata.DestinationIP),
			SourceIP:    strings.TrimSpace(item.Metadata.SourceIP),
			Chains:      normalizeChains(item.Chains),
			Rule:        defaultString(strings.TrimSpace(item.Rule), "Match"),
			RulePayload: strings.TrimSpace(item.RulePayload),
			Upload:      toInt64(item.Upload),
			Download:    toInt64(item.Download),
			TimestampMs: nowMs,
			StartMs:     parseClashStart(item.Start),
		})
	}

	return snapshots, nil
}

func (c *Client) collectSurge(ctx context.Context) ([]domain.FlowSnapshot, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.endpoint+"/v1/requests/recent", nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	if c.token != "" {
		req.Header.Set("x-key", c.token)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return nil, fmt.Errorf("gateway http %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, 4*1024*1024))
	if err != nil {
		return nil, fmt.Errorf("read surge response: %w", err)
	}

	var payload surgeRequestsResponse
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, fmt.Errorf("decode surge response: %w (debug: %s)", err, inspectSurgeDecodeError(body))
	}

	nowMs := time.Now().UnixMilli()
	snapshots := make([]domain.FlowSnapshot, 0, len(payload.Requests))
	for _, reqItem := range payload.Requests {
		id := strings.TrimSpace(string(reqItem.ID))
		if id == "" {
			continue
		}

		remoteHost := strings.TrimSpace(reqItem.RemoteHost)
		remoteAddress := strings.TrimSpace(strings.Split(remoteAddressFirst(reqItem.RemoteAddress), " ")[0])
		hostWithoutPort := extractHost(remoteHost)

		domainName := ""
		if isDomainName(remoteHost) {
			domainName = hostWithoutPort
		}
		ip := ""
		if isIPHost(remoteHost) {
			ip = hostWithoutPort
		} else if isIPHost(remoteAddress) {
			ip = extractHost(remoteAddress)
		}

		sourceIP := extractHost(defaultString(strings.TrimSpace(reqItem.LocalAddress), strings.TrimSpace(reqItem.SourceAddress)))
		chains := convertSurgeChains(reqItem.PolicyName, reqItem.OriginalPolicyName, []string(reqItem.Notes))
		rule := defaultString(strings.TrimSpace(lastChain(chains)), defaultString(strings.TrimSpace(reqItem.OriginalPolicyName), "Match"))
		rulePayload := strings.TrimSpace(reqItem.Rule)

		timestampMs := nowMs
		if reqItem.Time > 0 {
			timestampMs = toInt64(float64(reqItem.Time))
		}

		snapshots = append(snapshots, domain.FlowSnapshot{
			ID:          id,
			Domain:      domainName,
			IP:          ip,
			SourceIP:    sourceIP,
			Chains:      chains,
			Rule:        defaultString(rule, "Match"),
			RulePayload: rulePayload,
			Upload:      toInt64(float64(reqItem.OutBytes)),
			Download:    toInt64(float64(reqItem.InBytes)),
			TimestampMs: timestampMs,
			StartMs:     epochToMs(float64(reqItem.StartDate)),
		})
	}

	return snapshots, nil
}

// parseClashStart converts mihomo's RFC 3339 connection start time to epoch
// ms, returning 0 when missing or unparseable.
func parseClashStart(value string) int64 {
	value = strings.TrimSpace(value)
	if value == "" {
		return 0
	}
	t, err := time.Parse(time.RFC3339Nano, value)
	if err != nil {
		return 0
	}
	return t.UnixMilli()
}

// epochToMs accepts epoch seconds (Surge startDate) or milliseconds.
func epochToMs(value float64) int64 {
	if value <= 0 || math.IsNaN(value) || math.IsInf(value, 0) {
		return 0
	}
	if value < 1e12 {
		return toInt64(value * 1000)
	}
	return toInt64(value)
}

func normalizeChains(chains []string) []string {
	if len(chains) == 0 {
		return []string{"DIRECT"}
	}
	out := make([]string, 0, len(chains))
	for _, chain := range chains {
		trimmed := strings.TrimSpace(chain)
		if trimmed == "" {
			continue
		}
		out = append(out, trimmed)
		if len(out) >= 12 {
			break
		}
	}
	if len(out) == 0 {
		return []string{"DIRECT"}
	}
	return out
}

func lastChain(chains []string) string {
	if len(chains) == 0 {
		return ""
	}
	return strings.TrimSpace(chains[len(chains)-1])
}

func toInt64(v float64) int64 {
	if v <= 0 {
		return 0
	}
	if v > float64(^uint64(0)>>1) {
		return int64(^uint64(0) >> 1)
	}
	return int64(v)
}

func defaultString(v string, fallback string) string {
	if strings.TrimSpace(v) == "" {
		return fallback
	}
	return strings.TrimSpace(v)
}

func remoteAddressFirst(v string) string {
	parts := strings.Split(v, ",")
	if len(parts) == 0 {
		return ""
	}
	return strings.TrimSpace(parts[0])
}

func extractHost(hostWithPort string) string {
	hostWithPort = strings.TrimSpace(hostWithPort)
	if hostWithPort == "" {
		return ""
	}

	if strings.HasPrefix(hostWithPort, "[") {
		closing := strings.Index(hostWithPort, "]")
		if closing > 1 {
			return hostWithPort[1:closing]
		}
	}

	host, _, err := net.SplitHostPort(hostWithPort)
	if err == nil {
		return host
	}

	return strings.TrimSpace(hostWithPort)
}

func isIPHost(host string) bool {
	h := extractHost(host)
	if h == "" {
		return false
	}
	ip := net.ParseIP(h)
	return ip != nil
}

func isDomainName(host string) bool {
	h := extractHost(host)
	if h == "" {
		return false
	}
	if isIPHost(h) {
		return false
	}
	return domainPattern.MatchString(h)
}

func convertSurgeChains(policyName string, originalPolicyName string, notes []string) []string {
	if fromNotes := extractPolicyPathFromNotes(notes); len(fromNotes) >= 2 {
		return fromNotes
	}

	chains := make([]string, 0, 2)
	if p := strings.TrimSpace(policyName); p != "" {
		chains = append(chains, p)
	}
	o := strings.TrimSpace(originalPolicyName)
	if o != "" && o != strings.TrimSpace(policyName) {
		chains = append(chains, o)
	}
	if len(chains) == 0 {
		return []string{"DIRECT"}
	}
	return chains
}

func extractPolicyPathFromNotes(notes []string) []string {
	if len(notes) == 0 {
		return nil
	}
	for _, note := range notes {
		m := policyPathRegex.FindStringSubmatch(note)
		if len(m) < 2 {
			continue
		}
		segments := strings.Split(m[1], " -> ")
		cleaned := make([]string, 0, len(segments))
		for _, segment := range segments {
			s := strings.TrimSpace(segment)
			if s != "" {
				cleaned = append(cleaned, s)
			}
		}
		if len(cleaned) >= 2 {
			for i, j := 0, len(cleaned)-1; i < j; i, j = i+1, j-1 {
				cleaned[i], cleaned[j] = cleaned[j], cleaned[i]
			}
			return cleaned
		}
	}
	return nil
}

func inspectSurgeDecodeError(body []byte) string {
	if len(body) == 0 {
		return "empty response body"
	}

	var root map[string]json.RawMessage
	if err := json.Unmarshal(body, &root); err != nil {
		return "invalid json: " + truncateForLog(string(bytes.TrimSpace(body)), 240)
	}

	rawRequests, ok := root["requests"]
	if !ok {
		keys := make([]string, 0, len(root))
		for k := range root {
			keys = append(keys, k)
		}
		return "missing requests field, available keys: " + strings.Join(keys, ",")
	}

	var requests []map[string]json.RawMessage
	if err := json.Unmarshal(rawRequests, &requests); err != nil {
		return "requests is not array: " + truncateForLog(string(bytes.TrimSpace(rawRequests)), 240)
	}
	if len(requests) == 0 {
		return "requests array is empty"
	}

	rawID, ok := requests[0]["id"]
	if !ok {
		keys := make([]string, 0, len(requests[0]))
		for k := range requests[0] {
			keys = append(keys, k)
		}
		return "first request missing id, available keys: " + strings.Join(keys, ",")
	}

	return "first request id type=" + detectJSONType(rawID) + " value=" + truncateForLog(string(bytes.TrimSpace(rawID)), 80)
}

func detectJSONType(raw json.RawMessage) string {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 {
		return "empty"
	}
	switch trimmed[0] {
	case '"':
		return "string"
	case '{':
		return "object"
	case '[':
		return "array"
	case 't', 'f':
		return "boolean"
	case 'n':
		return "null"
	default:
		if (trimmed[0] >= '0' && trimmed[0] <= '9') || trimmed[0] == '-' {
			return "number"
		}
		return "unknown"
	}
}

func truncateForLog(s string, limit int) string {
	s = strings.TrimSpace(s)
	if limit <= 0 || len(s) <= limit {
		return s
	}
	return s[:limit] + "..."
}

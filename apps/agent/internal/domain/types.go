package domain

type TrafficUpdate struct {
	Domain      string   `json:"domain,omitempty"`
	IP          string   `json:"ip,omitempty"`
	Chain       string   `json:"chain"`
	Chains      []string `json:"chains"`
	Rule        string   `json:"rule"`
	RulePayload string   `json:"rulePayload,omitempty"`
	Upload      int64    `json:"upload"`
	Download    int64    `json:"download"`
	Connections int64    `json:"connections,omitempty"`
	SourceIP    string   `json:"sourceIP,omitempty"`
	TimestampMs int64    `json:"timestampMs"`
}

type FlowSnapshot struct {
	ID          string
	Domain      string
	IP          string
	SourceIP    string
	Chains      []string
	Rule        string
	RulePayload string
	Upload      int64
	Download    int64
	TimestampMs int64
	// StartMs is when the gateway opened the connection (epoch ms, 0 when the
	// gateway did not report it). Internal only; never sent to the server.
	StartMs int64
}

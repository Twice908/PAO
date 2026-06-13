# Changelog

## 0.1.0

- Initial release. Python port of `@pulse/agent`: `PulseAgent`, `AgentRun`,
  `AgentSpan`, with context-manager helpers for common span types
  (`with_llm_span`, `with_memory_span`, `with_agent_message_span`,
  `with_http_span`, `with_db_span`, `with_file_span`, `with_embedding_span`,
  `with_search_span`, `with_code_span`, `with_human_approval_span`,
  `with_sub_agent_span`).
- Payloads are byte-for-byte compatible with the npm package's
  `POST /ingest/agent-span` shape.

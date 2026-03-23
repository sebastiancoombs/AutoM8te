"""
Intent Router — Tier 1/2/3 Command Classification & Dispatch

Routes incoming voice/text commands to the fastest execution path:
- Tier 1: Regex pattern match → direct API call (target: <200ms)
- Tier 2: Lightweight LLM → structured JSON → execute (target: <2s)
- Tier 3: Full LLM planning for novel commands (target: <10s)

TODO (cron session 2026-03-24):
- [ ] Implement Tier 1 pattern matching
- [ ] Implement Tier 2 intent classification
- [ ] Implement Tier 3 fallback
- [ ] Streaming execution for multi-step plans
- [ ] Tests
"""

import re
import time
import logging
from dataclasses import dataclass, field
from typing import Optional, Dict, Any, List, Callable
from enum import Enum

logger = logging.getLogger(__name__)


class CommandTier(Enum):
    """Which execution tier handles this command."""
    TIER_1_INSTANT = 1   # Regex → direct API call, no LLM
    TIER_2_FAST = 2      # Lightweight LLM parse → structured action
    TIER_3_PLANNING = 3  # Full LLM reasoning for novel commands


@dataclass
class ParsedCommand:
    """Result of intent classification."""
    tier: CommandTier
    action: str                          # e.g., "takeoff", "land", "formation"
    params: Dict[str, Any] = field(default_factory=dict)
    raw_text: str = ""
    confidence: float = 1.0
    parse_time_ms: float = 0.0


@dataclass
class ExecutionResult:
    """Result of command execution."""
    success: bool
    message: str
    tier: CommandTier
    total_time_ms: float = 0.0
    parse_time_ms: float = 0.0
    exec_time_ms: float = 0.0


# ── Tier 1: Pattern Definitions ─────────────────────────────
# Each pattern maps regex → (action, param_extractor)
# param_extractor is a callable that takes the regex match and returns params dict

TIER_1_PATTERNS: List[tuple] = [
    # TODO: Fill these in during cron session
    # Format: (compiled_regex, action_name, param_extractor_fn)
    #
    # Examples to implement:
    # (re.compile(r"take\s*off(?:\s+to\s+(\d+)\s*(?:m|meters?))?", re.I),
    #  "takeoff", lambda m: {"altitude_m": float(m.group(1) or 10)}),
    #
    # (re.compile(r"land(?:\s+all)?", re.I),
    #  "land", lambda m: {"all": "all" in (m.group(0) or "")}),
    #
    # (re.compile(r"(?:v|vee)\s*formation", re.I),
    #  "formation", lambda m: {"formation_type": "v"}),
]


class IntentRouter:
    """
    Routes commands to the fastest execution tier.
    
    Usage:
        router = IntentRouter(command_router, swarm_manager_url)
        result = await router.execute("take off to 15 meters")
    """

    def __init__(self, swarm_manager_url: str = "http://localhost:8000"):
        self.base_url = swarm_manager_url
        self._tier1_patterns = TIER_1_PATTERNS
        self._tier2_cache: Dict[str, ParsedCommand] = {}  # Learned behavior cache

    def classify(self, text: str) -> ParsedCommand:
        """
        Classify a command into a tier.
        
        Priority: Tier 1 (regex) → Tier 2 (cached/fast LLM) → Tier 3 (full planning)
        """
        start = time.monotonic()

        # Try Tier 1: regex patterns
        cmd = self._try_tier1(text)
        if cmd:
            cmd.parse_time_ms = (time.monotonic() - start) * 1000
            return cmd

        # Try Tier 2: cached learned behaviors
        cmd = self._try_tier2_cache(text)
        if cmd:
            cmd.parse_time_ms = (time.monotonic() - start) * 1000
            return cmd

        # Fall through to Tier 3
        return ParsedCommand(
            tier=CommandTier.TIER_3_PLANNING,
            action="plan",
            params={"text": text},
            raw_text=text,
            confidence=0.0,
            parse_time_ms=(time.monotonic() - start) * 1000,
        )

    def _try_tier1(self, text: str) -> Optional[ParsedCommand]:
        """Try to match against Tier 1 regex patterns."""
        for pattern, action, extractor in self._tier1_patterns:
            match = pattern.search(text)
            if match:
                params = extractor(match) if extractor else {}
                return ParsedCommand(
                    tier=CommandTier.TIER_1_INSTANT,
                    action=action,
                    params=params,
                    raw_text=text,
                    confidence=1.0,
                )
        return None

    def _try_tier2_cache(self, text: str) -> Optional[ParsedCommand]:
        """Check if this command matches a previously learned behavior."""
        # TODO: Implement fuzzy matching against cached behaviors
        # This is where Tier 2 learned behaviors get instant recall
        return None

    async def execute(self, text: str) -> ExecutionResult:
        """
        Full pipeline: classify → route → execute → return result.
        """
        total_start = time.monotonic()

        # Step 1: Classify
        cmd = self.classify(text)
        logger.info(f"Classified '{text}' as {cmd.tier.name}: {cmd.action} "
                     f"(confidence={cmd.confidence:.2f}, parse={cmd.parse_time_ms:.1f}ms)")

        # Step 2: Execute based on tier
        exec_start = time.monotonic()

        if cmd.tier == CommandTier.TIER_1_INSTANT:
            result = await self._execute_tier1(cmd)
        elif cmd.tier == CommandTier.TIER_2_FAST:
            result = await self._execute_tier2(cmd)
        else:
            result = await self._execute_tier3(cmd)

        result.exec_time_ms = (time.monotonic() - exec_start) * 1000
        result.parse_time_ms = cmd.parse_time_ms
        result.total_time_ms = (time.monotonic() - total_start) * 1000

        logger.info(f"Executed {cmd.action}: total={result.total_time_ms:.0f}ms "
                     f"(parse={result.parse_time_ms:.0f}ms, exec={result.exec_time_ms:.0f}ms)")

        return result

    async def _execute_tier1(self, cmd: ParsedCommand) -> ExecutionResult:
        """Execute a Tier 1 command via direct API call."""
        # TODO: Map action → HTTP call to swarm manager
        return ExecutionResult(
            success=False,
            message=f"Tier 1 execution not yet implemented for: {cmd.action}",
            tier=CommandTier.TIER_1_INSTANT,
        )

    async def _execute_tier2(self, cmd: ParsedCommand) -> ExecutionResult:
        """Execute a Tier 2 command (fast LLM or cached behavior)."""
        # TODO: Implement lightweight LLM call or cached behavior lookup
        return ExecutionResult(
            success=False,
            message=f"Tier 2 execution not yet implemented for: {cmd.action}",
            tier=CommandTier.TIER_2_FAST,
        )

    async def _execute_tier3(self, cmd: ParsedCommand) -> ExecutionResult:
        """Execute a Tier 3 command (full LLM planning)."""
        # TODO: Implement full planning pipeline
        return ExecutionResult(
            success=False,
            message=f"Tier 3 planning not yet implemented for: {cmd.raw_text}",
            tier=CommandTier.TIER_3_PLANNING,
        )

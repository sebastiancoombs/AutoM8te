"""
Tests for the Intent Router — Tier 1/2/3 command classification.

Tests cover:
- Tier 1 regex pattern matching (when patterns are implemented)
- Classification correctness
- Execution timing targets
- Fallback to higher tiers
"""

import pytest
import time
from swarm_manager.intent_router import (
    IntentRouter, CommandTier, ParsedCommand, TIER_1_PATTERNS,
)


@pytest.fixture
def router():
    return IntentRouter(swarm_manager_url="http://localhost:8000")


class TestClassification:
    """Test that commands get routed to the correct tier."""

    def test_unknown_command_falls_to_tier3(self, router):
        """Novel commands should fall through to Tier 3."""
        cmd = router.classify("do a barrel roll while searching for aliens")
        assert cmd.tier == CommandTier.TIER_3_PLANNING

    def test_classification_is_fast(self, router):
        """Classification alone should be <10ms even for Tier 3 fallthrough."""
        start = time.monotonic()
        for _ in range(100):
            router.classify("take off")
        elapsed_ms = (time.monotonic() - start) * 1000
        # 100 classifications in under 100ms = <1ms each
        assert elapsed_ms < 100, f"Classification too slow: {elapsed_ms:.0f}ms for 100 runs"


class TestTier1Patterns:
    """Test Tier 1 regex patterns once implemented."""

    # TODO: Add tests for each Tier 1 pattern as they're implemented
    # Example tests to write:
    #
    # def test_takeoff_basic(self, router):
    #     cmd = router.classify("take off")
    #     assert cmd.tier == CommandTier.TIER_1_INSTANT
    #     assert cmd.action == "takeoff"
    #
    # def test_takeoff_with_altitude(self, router):
    #     cmd = router.classify("take off to 15 meters")
    #     assert cmd.tier == CommandTier.TIER_1_INSTANT
    #     assert cmd.action == "takeoff"
    #     assert cmd.params["altitude_m"] == 15.0
    #
    # def test_land(self, router):
    #     cmd = router.classify("land")
    #     assert cmd.tier == CommandTier.TIER_1_INSTANT
    #     assert cmd.action == "land"
    #
    # def test_land_all(self, router):
    #     cmd = router.classify("land all drones")
    #     assert cmd.tier == CommandTier.TIER_1_INSTANT
    #     assert cmd.action == "land"
    #     assert cmd.params.get("all") == True
    #
    # def test_formation_v(self, router):
    #     cmd = router.classify("fly in V formation")
    #     assert cmd.tier == CommandTier.TIER_1_INSTANT
    #     assert cmd.action == "formation"
    #     assert cmd.params["formation_type"] == "v"
    #
    # def test_formation_line(self, router):
    #     cmd = router.classify("line formation")
    #     assert cmd.tier == CommandTier.TIER_1_INSTANT
    #     assert cmd.action == "formation"
    #     assert cmd.params["formation_type"] == "line"
    #
    # def test_rtl(self, router):
    #     cmd = router.classify("return to home")
    #     assert cmd.tier == CommandTier.TIER_1_INSTANT
    #     assert cmd.action == "return_home"
    #
    # def test_emergency_stop(self, router):
    #     cmd = router.classify("emergency stop")
    #     assert cmd.tier == CommandTier.TIER_1_INSTANT
    #     assert cmd.action == "emergency_stop"

    pass


class TestTimingTargets:
    """Verify execution meets latency targets."""

    def test_tier1_target_200ms(self, router):
        """Tier 1 classification should be <1ms (execution target <200ms total)."""
        cmd = router.classify("take off")
        # Even falling through to Tier 3, classification is near-instant
        assert cmd.parse_time_ms < 5.0

    # TODO: Add async execution timing tests once execute() is implemented

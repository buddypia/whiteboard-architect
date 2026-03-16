import unittest

from services.live_model_service import LiveModelService, ModelProbeResult


class LiveModelServiceTests(unittest.IsolatedAsyncioTestCase):
    async def test_initialize_filters_only_unsupported_candidates(self):
        service = LiveModelService(["model-a", "model-b", "model-c"])

        async def fake_probe(model_name: str) -> ModelProbeResult:
            mapping = {
                "model-a": ModelProbeResult(status="unsupported", detail="1008"),
                "model-b": ModelProbeResult(status="supported"),
                "model-c": ModelProbeResult(status="unknown", detail="timeout"),
            }
            return mapping[model_name]

        service._probe_candidate = fake_probe  # type: ignore[method-assign]

        await service.initialize()

        self.assertEqual(service.model_candidates, ["model-b", "model-c"])
        self.assertEqual(service.active_model, "model-b")

    async def test_mark_model_unsupported_removes_it_from_future_candidates(self):
        service = LiveModelService(["model-a", "model-b"])

        await service.mark_model_unsupported("model-a", RuntimeError("1008 unsupported"))

        self.assertEqual(service.model_candidates, ["model-b"])
        self.assertEqual(service.probe_results["model-a"]["status"], "unsupported")

    async def test_initialize_skips_known_unsupported_preview_before_probing(self):
        service = LiveModelService([
            "gemini-2.5-flash-native-audio-preview-12-2025",
            "model-b",
        ])

        async def fake_probe(model_name: str) -> ModelProbeResult:
            self.assertEqual(model_name, "model-b")
            return ModelProbeResult(status="supported")

        service._probe_candidate = fake_probe  # type: ignore[method-assign]

        await service.initialize()

        self.assertEqual(service.model_candidates, ["model-b"])
        self.assertEqual(
            service.probe_results["gemini-2.5-flash-native-audio-preview-12-2025"]["status"],
            "unsupported",
        )


if __name__ == "__main__":
    unittest.main()

# A tiny global registry so a debug overlay (PatterStatePanel) can find the engines your game
# created, without you wiring a reference through. Call PatterDebug.register(engine) right after
# you build an Engine, and PatterDebug.unregister(engine) when you tear it down. Parity with the
# Unity PatterDebug.Register(...) hook the PatterStateWindow reads.
class_name PatterDebug

static var engines: Array = []


static func register(engine) -> void:
	if not engines.has(engine):
		engines.append(engine)


static func unregister(engine) -> void:
	engines.erase(engine)


static func clear() -> void:
	engines.clear()

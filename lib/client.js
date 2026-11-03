window.__ModuleLoader__.load({
	id: "@dsh-external/dsh-render-perf",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		// \0rolldown/runtime.js
		var __create = Object.create;
		var __defProp = Object.defineProperty;
		var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
		var __getOwnPropNames = Object.getOwnPropertyNames;
		var __getProtoOf = Object.getPrototypeOf;
		var __hasOwnProp = Object.prototype.hasOwnProperty;
		var __copyProps = (to, from, except, desc) => {
			if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
				key = keys[i];
				if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
					get: ((k) => from[k]).bind(null, key),
					enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
				});
			}
			return to;
		};
		var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule || !__hasOwnProp.call(mod, "default") ? __defProp(target, "default", {
			value: mod,
			enumerable: true
		}) : target, mod));
		let react = require("react");
		react = __toESM(react, 1);
		// src/client/index.ts
		/** 稳定插件名（与 host 端一致）。 */
		const name = "@dsh-external/dsh-render-perf";
		/** 使用 slots 服务，必须声明。 */
		const inject = ["slots"];
		/** 卡片条目 id（同槽位内唯一）。 */
		const PANEL_ID = "@dsh-external/dsh-render-perf";
		/**
		* 读取统计数据。
		* @returns 统计对象；补丁未生效时为 undefined。
		*/
		function readStats() {
			return globalThis.__DSH_RENDER_PERF__;
		}
		/** 表格行样式。 */
		const rowLabelStyle = {
			padding: "3px 16px 3px 0",
			opacity: .72
		};
		const rowValueStyle = { padding: "3px 0" };
		/**
		* 一行指标。
		* @param props - 标签与取值。
		* @returns 表格行。
		*/
		function MetricRow(props) {
			return react.createElement("tr", null, react.createElement("td", { style: rowLabelStyle }, props.label), react.createElement("td", { style: rowValueStyle }, react.createElement("b", { style: props.accent !== void 0 ? { color: props.accent } : void 0 }, props.value)));
		}
		/**
		* 诊断卡片（React 函数组件）。
		* @returns 卡片内容。
		*/
		function RenderPerfCard() {
			const [tick, setTick] = react.useState(0);
			react.useEffect(() => {
				const timer = window.setInterval(() => setTick((value) => value + 1), 1500);
				return () => window.clearInterval(timer);
			}, []);
			const stats = readStats();
			const styleOn = document.getElementById("dsh-render-perf-style") !== null;
			const katexCount = document.querySelectorAll(".katex").length;
			const nodeCount = document.querySelectorAll("*").length;
			const total = stats !== void 0 ? stats.hits + stats.misses : 0;
			const hitRate = stats !== void 0 && total > 0 ? (stats.hits / total * 100).toFixed(1) + "%" : "—";
			const cacheSize = stats?.cache !== void 0 ? stats.cache.size : 0;
			return react.createElement("div", { style: {
				padding: "14px 16px",
				fontSize: 13,
				lineHeight: 1.75
			} }, react.createElement("h3", { style: {
				fontSize: 15,
				margin: "0 0 8px"
			} }, "⚡ 渲染性能"), react.createElement("div", { style: { marginBottom: 6 } }, "公式渲染缓存：", stats !== void 0 ? react.createElement("b", { style: { color: "#22c55e" } }, "已启用") : react.createElement("b", { style: { color: "#f59e0b" } }, "未生效（请硬刷新页面）")), react.createElement("table", { style: {
				borderCollapse: "collapse",
				fontSize: 12.5
			} }, react.createElement("tbody", null, react.createElement(MetricRow, {
				label: "缓存命中次数",
				value: stats !== void 0 ? String(stats.hits) : "—"
			}), react.createElement(MetricRow, {
				label: "缓存未命中（实际编译）",
				value: stats !== void 0 ? String(stats.misses) : "—"
			}), react.createElement(MetricRow, {
				label: "命中率",
				value: hitRate
			}), react.createElement(MetricRow, {
				label: "缓存条目 / 上限",
				value: cacheSize + " / " + (stats !== void 0 ? String(stats.max) : "—")
			}), react.createElement(MetricRow, {
				label: "视口外渲染跳过",
				value: styleOn ? "已启用" : "未启用",
				accent: styleOn ? "#22c55e" : "#f59e0b"
			}), react.createElement(MetricRow, {
				label: "当前页面公式数",
				value: String(katexCount)
			}), react.createElement(MetricRow, {
				label: "当前 DOM 节点数",
				value: String(nodeCount)
			}))), react.createElement("p", { style: {
				fontSize: 12,
				opacity: .7,
				margin: "8px 0 0"
			} }, "切换会话时「缓存未命中」不应增长，命中次数持续增加即为缓存生效。"));
		}
		/**
		* 客户端入口。
		* @param ctx - 客户端 cordis 上下文。
		*/
		function apply(ctx) {
			ctx.effect(() => ctx.slots.inject("settings.plugin.item", () => ctx.slots.register({
				name: "settings.plugin.item",
				id: PANEL_ID,
				order: 60,
				label: () => "渲染性能"
			}, RenderPerfCard)), "dsh-render-perf: settings card");
		}
		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map
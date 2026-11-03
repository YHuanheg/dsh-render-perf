import z from '@deepseek-ai/schemastery';
/** 稳定插件名。 */
export declare const name = "@dsh-external/dsh-render-perf";
/** 需要 webServer 服务就绪后才 apply。 */
export declare const inject: string[];
/**
 * 插件配置 schema（schemastery）。
 *
 * 导出 Config 后，本插件才会在「设置 → 插件」里带出可配置项。
 */
export declare const Config: z<Schemastery.ObjectS<NoInfer<{
    /** 总开关。 */
    enabled: z<boolean, boolean, "defined">;
    /** 手动指定 dsh-web-frontend 的 dist 目录（留空自动探测）。 */
    distDir: z<string, string, "defined">;
    /** 补丁模式：element（默认，实测最快）/ html（可选的 innerHTML 变体，较慢）。 */
    mode: z<"html" | "element", "html" | "element", "defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    /** 总开关。 */
    enabled: z<boolean, boolean, "defined">;
    /** 手动指定 dsh-web-frontend 的 dist 目录（留空自动探测）。 */
    distDir: z<string, string, "defined">;
    /** 补丁模式：element（默认，实测最快）/ html（可选的 innerHTML 变体，较慢）。 */
    mode: z<"html" | "element", "html" | "element", "defined">;
}>>, "plain">;
/** 解析后的配置形态。 */
export interface ConfigShape {
    enabled: boolean;
    distDir: string;
    mode: 'element' | 'html';
}
/**
 * 插件入口。
 * @param ctx - cordis 上下文（含 webServer 服务）。
 * @param config - 插件配置。
 */
export declare function apply(ctx: any, config?: Partial<ConfigShape>): void;

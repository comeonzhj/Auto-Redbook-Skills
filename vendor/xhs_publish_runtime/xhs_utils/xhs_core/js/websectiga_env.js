/**
 * env_core.js — 环境补齐引擎（v2）
 *
 * 纯工具集 + Proxy 引擎 + 诊断报告。不含任何环境存根。
 * 存根由 Claude 在 run.js 中按诊断报告按需编写。
 *
 * 导出：
 *   setFuncNative(fn, name, len)     — 函数伪装三件套
 *   setObjNative(obj, name)          — 对象伪装两件套
 *   getNativeProto(ctorName, attrs)  — 原型链工厂
 *   wrapFunc(obj, method, callback)  — 方法包装
 *   monitor(target, name, config)    — 定向监控 Proxy
 *   createProxy(target, name, depth) — 递归 Proxy 工厂
 *   init(config)                     — 最小初始化（Node 泄露阻断 + 全局引用）
 *   report()                         — 诊断报告
 */

const __env__ = (function () {

    // ==================== 数据收集 ====================
    const _errors = [];                // { path, operation, message }
    const _undefinedGets = {};         // path -> count
    const _functionCalls = {};         // path -> { count, args[] }
    const _successfulGets = {};        // path -> count

    const _proxyCache = new WeakMap(); // target -> proxy

    // ==================== 函数伪装 ====================
    // 参考 sdenv setFunc.js：name + length + toString 三件套

    const _origToString = Function.prototype.toString;
    const _nativeNames = new Set();

    const nativeToString = function toString() {
        if (_nativeNames.has(this)) {
            const name = this.name || '';
            return `function ${name}() { [native code] }`;
        }
        return _origToString.call(this);
    };
    // toString 自身也要伪装
    Object.defineProperty(nativeToString, 'name', { value: 'toString', configurable: true });
    _nativeNames.add(nativeToString);

    /**
     * 函数伪装三件套：name + length + toString
     * @param {Function} fn - 目标函数
     * @param {string} [name] - 函数名（不传则保留原名）
     * @param {number} [len] - 参数个数
     */
    function setFuncNative(fn, name, len) {
        if (!fn) return undefined;
        if (typeof name === 'number') { len = name; name = undefined; }
        if (typeof name === 'string') {
            Object.defineProperty(fn, 'name', { value: name, configurable: true });
        }
        if (typeof len === 'number') {
            Object.defineProperty(fn, 'length', { value: len, configurable: true });
        }
        _nativeNames.add(fn);
        Object.defineProperty(fn, 'toString', {
            enumerable: false, configurable: true, writable: true,
            value: nativeToString,
        });
        return fn;
    }

    // 全局接管 Function.prototype.toString
    Function.prototype.toString = nativeToString;

    // ==================== 对象伪装 ====================
    // 参考 sdenv setObj.js：toString + Symbol.toStringTag 两件套

    /**
     * 对象伪装两件套：toString + Symbol.toStringTag
     * @param {Object} obj - 目标对象
     * @param {string} name - 类型名（如 "Navigator", "HTMLDocument"）
     */
    function setObjNative(obj, name) {
        Object.defineProperty(obj, 'toString', {
            enumerable: false, configurable: true, writable: true,
            value() { return `[object ${name}]`; }
        });
        Object.defineProperty(obj, Symbol.toStringTag, {
            configurable: true, enumerable: false, writable: false,
            value: name
        });
        return obj;
    }

    // ==================== 原型链工厂 ====================
    // 参考 sdenv getNativeProto.js：Constructor + prototype 实例

    /**
     * 创建带原型链的构造函数 + 实例
     * @param {string} ctorName - 构造函数名（如 "Navigator"）
     * @param {Object} [attrs] - 实例属性
     * @returns {[Function, Object]} [Constructor, instance]
     */
    function getNativeProto(ctorName, attrs) {
        attrs = attrs || {};
        const ctor = setFuncNative(function () {
            throw new TypeError('Illegal constructor');
        }, ctorName, 0);
        const instance = Object.create(ctor.prototype);
        setObjNative(instance, ctorName);
        Object.assign(instance, attrs);
        return [ctor, instance];
    }

    // ==================== 方法包装 ====================
    // 参考 sdenv setFunc.js wrapFunc：保留原引用 + 自动伪装

    /**
     * 包装对象方法，保留原函数引用
     * @param {Object} obj - 宿主对象
     * @param {string} method - 方法名
     * @param {Function} callback - (origFn, ...args) => result
     */
    function wrapFunc(obj, method, callback) {
        const orig = obj[method];
        const wrap = function (...args) {
            return callback.call(this, orig.bind(this), ...args);
        };
        setFuncNative(wrap, method, orig ? orig.length : 0);
        obj[method] = wrap;
        return wrap;
    }

    // ==================== 辅助函数 ====================

    function summarize(v) {
        if (v === undefined) return 'undefined';
        if (v === null) return 'null';
        const t = typeof v;
        if (t === 'function') return `fn:${v.name || '?'}`;
        if (t === 'string') return v.length > 60 ? `"${v.slice(0, 60)}…"` : `"${v}"`;
        if (t === 'number' || t === 'boolean') return String(v);
        if (t === 'symbol') return v.toString();
        if (Array.isArray(v)) return `Array(${v.length})`;
        try {
            const name = v.constructor?.name;
            return name && name !== 'Object' ? `[${name}]` : '{…}';
        } catch { return '{…}'; }
    }

    function recordUndefined(path) {
        _undefinedGets[path] = (_undefinedGets[path] || 0) + 1;
    }
    function recordSuccess(path) {
        _successfulGets[path] = (_successfulGets[path] || 0) + 1;
    }
    function recordCall(path, args) {
        if (!_functionCalls[path]) _functionCalls[path] = { count: 0, args: [] };
        const entry = _functionCalls[path];
        entry.count++;
        if (entry.args.length < 3) {
            const summary = args.map(summarize).join(', ');
            if (!entry.args.includes(summary)) entry.args.push(summary);
        }
    }
    function recordError(path, operation, err) {
        const msg = err instanceof Error ? err.message : String(err);
        const key = `${path}|${msg}`;
        if (!_errors.some(e => `${e.path}|${e.message}` === key)) {
            _errors.push({ path, operation, message: msg });
        }
    }

    // 不记录的属性（引擎内部 / 会导致递归）
    const SKIP = new Set([
        'constructor', 'prototype', '__proto__',
        'toJSON', 'hasOwnProperty', 'isPrototypeOf',
        'propertyIsEnumerable', 'valueOf',
        'inspect', 'then', 'asymmetricMatch', 'nodeType',
        '$$typeof', '@@__IMMUTABLE_ITERABLE__@@',
    ]);

    // 不自动递归 Proxy 的对象
    const NO_RECURSE_CTORS = new Set([
        'ArrayBuffer', 'SharedArrayBuffer', 'DataView',
        'Int8Array', 'Uint8Array', 'Uint8ClampedArray',
        'Int16Array', 'Uint16Array', 'Int32Array', 'Uint32Array',
        'Float32Array', 'Float64Array', 'BigInt64Array', 'BigUint64Array',
        'Map', 'Set', 'WeakMap', 'WeakSet',
        'Date', 'RegExp', 'Promise',
        'Error', 'TypeError', 'RangeError', 'ReferenceError', 'SyntaxError',
    ]);

    function shouldProxy(obj) {
        if (obj === null || obj === undefined) return false;
        const t = typeof obj;
        if (t !== 'object' && t !== 'function') return false;
        try {
            const name = obj.constructor?.name;
            if (name && NO_RECURSE_CTORS.has(name)) return false;
        } catch {}
        return true;
    }

    // ==================== 定向监控 Proxy ====================
    // 参考 sdenv monitor.js：可配置 log/keys/parse/cb/handles

    /**
     * 定向监控 Proxy —— 对已有对象包一层可配置的 Proxy
     * @param {Object} target - 监控目标
     * @param {string} name - 显示名
     * @param {Object} config
     *   config.log       — 开启 get/set 日志
     *   config.getLog    — 仅 get 日志
     *   config.setLog    — 仅 set 日志
     *   config.keys      — 触发 debugger 的属性名数组
     *   config.getKeys   — 仅 get 触发
     *   config.setKeys   — 仅 set 触发
     *   config.cb        — 通用回调 (property, value, name)
     *   config.getCb     — get 回调
     *   config.setCb     — set 回调
     *   config.getParse  — get 返回值变换 (key, val) => newVal
     *   config.setParse  — set 值变换 (key, val) => newVal
     *   config.handles   — 额外 Proxy handler（展开合并）
     */
    function monitor(target, name, config) {
        config = config || {};
        const {
            getLog, setLog, log,
            getKeys = [], setKeys = [], keys = [],
            getCb, setCb, cb,
            getParse = (k, v) => v,
            setParse = (k, v) => v,
            handles = {},
        } = config;

        return new Proxy(target, {
            get(obj, prop, receiver) {
                if (typeof prop === 'symbol') return Reflect.get(obj, prop, receiver);
                if (getLog || log) console.log(`[monitor] ${name}.${prop} GET`);
                if (getKeys.includes(prop) || keys.includes(prop)) debugger;
                (getCb || cb)?.(prop, name);
                return getParse(prop, Reflect.get(obj, prop, receiver), obj);
            },
            set(obj, prop, value, receiver) {
                if (typeof prop === 'symbol') return Reflect.set(obj, prop, value, receiver);
                if (setLog || log) console.log(`[monitor] ${name}.${prop} SET =`, value);
                if (setKeys.includes(prop) || keys.includes(prop)) debugger;
                (setCb || cb)?.(prop, value, name);
                return Reflect.set(obj, prop, setParse(prop, value, obj), receiver);
            },
            ...handles,
        });
    }

    // ==================== 递归 Proxy 工厂 ====================
    // 从现有 proxy_monitor.js 演化，补全到 8 trap

    /**
     * 递归 Proxy 工厂 —— 自动追踪所有属性访问和函数调用
     * @param {Object} target - 包裹目标
     * @param {string} name - 路径名（如 "window"）
     * @param {number} [depth=0] - 递归深度（>8 停止）
     */
    function createProxy(target, name, depth) {
        depth = depth || 0;
        if (depth > 8) return target;
        if (!shouldProxy(target)) return target;
        if (_proxyCache.has(target)) return _proxyCache.get(target);

        const proxy = new Proxy(target, {
            get(obj, prop, receiver) {
                if (typeof prop === 'symbol') {
                    if (prop === Symbol.toStringTag) {
                        const tag = Reflect.get(obj, prop, receiver);
                        return tag !== undefined ? tag : undefined;
                    }
                    return Reflect.get(obj, prop, receiver);
                }
                if (SKIP.has(prop)) return Reflect.get(obj, prop, receiver);

                const chain = `${name}.${prop}`;
                let value;
                try {
                    value = Reflect.get(obj, prop, receiver);
                } catch (err) {
                    recordError(chain, 'get', err);
                    return undefined;
                }

                if (value === undefined) {
                    recordUndefined(chain);
                } else {
                    recordSuccess(chain);
                }

                if (typeof value === 'function') {
                    const needsBind = (obj instanceof Map || obj instanceof Set ||
                        obj instanceof Date || obj instanceof RegExp ||
                        obj instanceof Promise || ArrayBuffer.isView(obj));

                    const wrappedFn = function (...args) {
                        recordCall(chain, args);
                        try {
                            const thisArg = (this === proxy) ? obj : this;
                            const result = needsBind
                                ? value.apply(obj, args)
                                : value.apply(thisArg, args);
                            if (shouldProxy(result)) {
                                try { return createProxy(result, chain + '()', depth + 1); }
                                catch { return result; }
                            }
                            return result;
                        } catch (err) {
                            recordError(chain, 'call', err);
                            throw err;
                        }
                    };
                    setFuncNative(wrappedFn, prop);
                    return wrappedFn;
                }

                if (shouldProxy(value)) {
                    try { return createProxy(value, chain, depth + 1); }
                    catch { return value; }
                }
                return value;
            },

            set(obj, prop, value, receiver) {
                if (typeof prop === 'symbol') return Reflect.set(obj, prop, value, receiver);
                try {
                    return Reflect.set(obj, prop, value, receiver);
                } catch (err) {
                    recordError(`${name}.${prop}`, 'set', err);
                    return false;
                }
            },

            has(obj, prop) {
                return Reflect.has(obj, prop);
            },

            deleteProperty(obj, prop) {
                return Reflect.deleteProperty(obj, prop);
            },

            getOwnPropertyDescriptor(obj, prop) {
                return Reflect.getOwnPropertyDescriptor(obj, prop);
            },

            defineProperty(obj, prop, desc) {
                return Reflect.defineProperty(obj, prop, desc);
            },

            ownKeys(obj) {
                return Reflect.ownKeys(obj);
            },

            getPrototypeOf(obj) {
                return Reflect.getPrototypeOf(obj);
            },

            ...(typeof target === 'function' ? {
                apply(fn, thisArg, args) {
                    recordCall(name, args);
                    try {
                        const result = Reflect.apply(fn, thisArg, args);
                        if (shouldProxy(result)) {
                            try { return createProxy(result, name + '()', depth + 1); }
                            catch { return result; }
                        }
                        return result;
                    } catch (err) {
                        recordError(name, 'call', err);
                        throw err;
                    }
                },
                construct(fn, args, newTarget) {
                    recordCall(`new ${name}`, args);
                    try {
                        const result = Reflect.construct(fn, args, newTarget);
                        if (shouldProxy(result)) {
                            try { return createProxy(result, `new ${name}()`, depth + 1); }
                            catch { return result; }
                        }
                        return result;
                    } catch (err) {
                        recordError(`new ${name}`, 'construct', err);
                        throw err;
                    }
                }
            } : {})
        });

        _proxyCache.set(target, proxy);
        return proxy;
    }

    // ==================== 最小初始化 ====================

    /**
     * 最小初始化 —— 只做 Node 泄露阻断和全局引用挂载
     * 不创建任何存根对象，存根由 run.js 按需编写
     * @param {Object} [config]
     *   config.window    — 已构建好的 window 对象
     *   config.document  — 已构建好的 document 对象
     *   config.navigator — 已构建好的 navigator 对象
     *   config.location  — 已构建好的 location 对象
     */
    function init(config) {
        config = config || {};

        // Node.js 特征隐藏
        const nodeFeatures = ['process', 'Buffer', '__dirname', '__filename'];
        for (const feat of nodeFeatures) {
            if (feat in global) {
                try {
                    Object.defineProperty(global, feat, {
                        value: undefined, writable: false, enumerable: false, configurable: true
                    });
                } catch {}
            }
        }

        // 挂载全局引用
        const globals = {};
        if (config.window) {
            globals.window = config.window;
            globals.self = config.window;
            globals.top = config.window;
            globals.parent = config.window;
            globals.globalThis = config.window;
        }
        if (config.document) globals.document = config.document;
        if (config.navigator) globals.navigator = config.navigator;
        if (config.location) globals.location = config.location;

        for (const [k, v] of Object.entries(globals)) {
            Object.defineProperty(global, k, {
                value: v, writable: true, configurable: true, enumerable: true
            });
        }
    }

    // ==================== 诊断报告 ====================

    function report() {
        const lines = [];
        const errorCount = _errors.length;
        const undefCount = Object.keys(_undefinedGets).length;
        const callCount = Object.keys(_functionCalls).length;
        const okCount = Object.keys(_successfulGets).length;

        lines.push('');
        lines.push('========== ENV PATCH REPORT ==========');
        lines.push('');

        if (errorCount > 0) {
            lines.push(`[ERRORS] (${errorCount}) — must fix:`);
            for (const e of _errors) {
                lines.push(`  ${e.path} [${e.operation}] → ${e.message}`);
            }
            lines.push('');
        }

        if (undefCount > 0) {
            lines.push(`[UNDEFINED] (${undefCount}) — likely need patching:`);
            const sorted = Object.entries(_undefinedGets).sort((a, b) => b[1] - a[1]);
            for (const [path, count] of sorted) {
                lines.push(`  ${path}  (×${count})`);
            }
            lines.push('');
        }

        if (callCount > 0) {
            lines.push(`[CALLS] (${callCount}) — function calls observed:`);
            const sorted = Object.entries(_functionCalls).sort((a, b) => b[1].count - a[1].count);
            for (const [path, info] of sorted) {
                const argSamples = info.args.length > 0 ? `  args: [${info.args.join('] [')}]` : '';
                lines.push(`  ${path}  (×${info.count})${argSamples}`);
            }
            lines.push('');
        }

        lines.push(`Summary: ${errorCount} errors, ${undefCount} undefined, ${callCount} calls, ${okCount} ok (hidden)`);
        lines.push('=======================================');
        lines.push('');

        console.log(lines.join('\n'));
        return { errors: _errors, undefined: _undefinedGets, calls: _functionCalls };
    }

    process.on('exit', report);

    function _reset() {
        _errors.length = 0;
        for (const k in _undefinedGets) delete _undefinedGets[k];
        for (const k in _functionCalls) delete _functionCalls[k];
        for (const k in _successfulGets) delete _successfulGets[k];
    }

    return {
        setFuncNative,
        setObjNative,
        getNativeProto,
        wrapFunc,
        monitor,
        createProxy,
        init,
        report,
        _reset,
    };
})();

module.exports = __env__;

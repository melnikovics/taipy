/*
 * Copyright 2021-2025 Avaiga Private Limited
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 *
 *        http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on
 * an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the
 * specific language governing permissions and limitations under the License.
 */

import React, { CSSProperties, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useTheme } from "@mui/material";
import Box from "@mui/material/Box";
import Skeleton from "@mui/material/Skeleton";
import Tooltip from "@mui/material/Tooltip";
import merge from "lodash/merge";
import { nanoid } from "nanoid";
import {
    Config,
    Data,
    Layout,
    ModeBarButtonAny,
    PlotDatum,
    PlotMarker,
    PlotRelayoutEvent,
    PlotSelectionEvent,
    ScatterLine,
} from "plotly.js";
import { Figure } from "react-plotly.js";

import {
    createRequestChartUpdateAction,
    createSendActionNameAction,
    createSendUpdateAction,
} from "../../context/taipyReducers";
import { lightenPayload } from "../../context/wsUtils";
import { darkThemeTemplate } from "../../themes/darkThemeTemplate";
import {
    useClassNames,
    useDispatch,
    useDispatchRequestUpdateOnFirstRender,
    useDynamicJsonProperty,
    useDynamicProperty,
    useModule,
} from "../../utils/hooks";
import { ColumnDesc } from "./tableUtils";
import { getComponentClassName } from "./TaipyStyle";
import { getArrayValue, getUpdateVar, TaipyActiveProps, TaipyChangeProps } from "./utils";

const Plot = lazy(() => import("react-plotly.js"));

interface ChartProp extends TaipyActiveProps, TaipyChangeProps {
    title?: string;
    width?: string | number;
    height?: string | number;
    defaultConfig: string;
    config?: string;
    data?: Record<string, TraceValueType>;
    //data${number}?: Record<string, TraceValueType>;
    defaultLayout?: string;
    layout?: string;
    plotConfig?: string;
    onRangeChange?: string;
    render?: boolean;
    defaultRender?: boolean;
    template?: string;
    template_Dark_?: string;
    template_Light_?: string;
    //[key: `selected${number}`]: number[];
    figure?: Array<Record<string, unknown>>;
    onClick?: string;
    dataVarNames?: string;
}

interface ChartConfig {
    columns: Array<Record<string, ColumnDesc>>;
    labels: string[];
    modes: string[];
    types: string[];
    traces: string[][];
    xaxis: string[];
    yaxis: string[];
    markers: Partial<PlotMarker>[];
    selectedMarkers: Partial<PlotMarker>[];
    orientations: string[];
    names: string[];
    lines: Partial<ScatterLine>[];
    texts: string[];
    textAnchors: string[];
    options: Record<string, unknown>[];
    axisNames: Array<string[]>;
    addIndex: Array<boolean>;
    decimators?: string[];
}

export type TraceValueType = Record<string, (string | number)[]>;

const defaultStyle = { position: "relative", display: "inline-block" };

const indexedData = /^(\d+)\/(.*)/;

export const getColNameFromIndexed = (colName: string): string => {
    if (colName) {
        const reRes = indexedData.exec(colName);
        if (reRes && reRes.length > 2) {
            return reRes[2] || colName;
        }
    }
    return colName;
};

export const getValue = <T,>(
    values: TraceValueType | undefined,
    arr: T[],
    idx: number,
    returnUndefined = false
): (string | number)[] | undefined => {
    const value = getValueFromCol(values, getArrayValue(arr, idx) as unknown as string);
    if (!returnUndefined || value.length) {
        return value;
    }
    return undefined;
};

export const getValueFromCol = (values: TraceValueType | undefined, col: string): (string | number)[] => {
    if (values) {
        if (col) {
            // TODO: Re-review the logic here
            if (Array.isArray(values)) {
                const reRes = indexedData.exec(col);
                if (reRes && reRes.length > 2) {
                    return values[parseInt(reRes[1], 10) || 0][reRes[2] || col] || [];
                }
            } else {
                return values[col] || [];
            }
        }
    }
    return [];
};

export const getAxis = (traces: string[][], idx: number, columns: Record<string, ColumnDesc>, axis: number) => {
    if (traces.length > idx && traces[idx].length > axis && traces[idx][axis] && columns[traces[idx][axis]])
        return columns[traces[idx][axis]].dfid;
    return undefined;
};

const getDecimatorsPayload = (
    decimators: string[] | undefined,
    plotDiv: HTMLDivElement | null,
    modes: string[],
    columns: Record<string, ColumnDesc>,
    traces: string[][],
    relayoutData?: PlotRelayoutEvent
) => {
    return decimators
        ? {
              width: plotDiv?.clientWidth,
              height: plotDiv?.clientHeight,
              decimators: decimators.map((d, i) =>
                  d
                      ? {
                            decimator: d,
                            xAxis: getAxis(traces, i, columns, 0),
                            yAxis: getAxis(traces, i, columns, 1),
                            zAxis: getAxis(traces, i, columns, 2),
                            chartMode: modes[i],
                        }
                      : {
                            xAxis: getAxis(traces, i, columns, 0),
                            yAxis: getAxis(traces, i, columns, 1),
                            zAxis: getAxis(traces, i, columns, 2),
                            chartMode: modes[i],
                        }
              ),
              relayoutData: relayoutData,
          }
        : undefined;
};

const selectedPropRe = /selected(\d+)/;

const MARKER_TO_COL = ["color", "size", "symbol", "opacity", "colors"];

const isOnClick = (types: string[]) => (types?.length ? types.every((t) => t === "pie") : false);

interface Axis {
    p2c: () => number;
    p2d: (a: number) => number;
}
interface PlotlyMap {
    _subplot?: { xaxis: Axis; yaxis: Axis };
}
interface PlotlyDiv extends HTMLDivElement {
    _fullLayout?: {
        map?: PlotlyMap;
        geo?: PlotlyMap;
        mapbox?: PlotlyMap;
        xaxis?: Axis;
        yaxis?: Axis;
    };
}

interface WithPointNumbers {
    pointNumbers: number[];
}

export const getPlotIndex = (pt: PlotDatum) =>
    pt.pointIndex === undefined
        ? pt.pointNumber === undefined
            ? (pt as unknown as WithPointNumbers).pointNumbers?.length
                ? (pt as unknown as WithPointNumbers).pointNumbers[0]
                : 0
            : pt.pointNumber
        : pt.pointIndex;

const defaultConfig = {
    columns: [] as Array<Record<string, ColumnDesc>>,
    labels: [],
    modes: [],
    types: [],
    traces: [],
    xaxis: [],
    yaxis: [],
    markers: [],
    selectedMarkers: [],
    orientations: [],
    names: [],
    lines: [],
    texts: [],
    textAnchors: [],
    options: [],
    axisNames: [],
    addIndex: [],
} as ChartConfig;

const emptyLayout = {} as Partial<Layout>;
const emptyData = {} as Record<string, TraceValueType>;

export const TaipyPlotlyButtons: ModeBarButtonAny[] = [
    {
        name: "Full screen",
        title: "Full screen",
        icon: {
            height: 24,
            width: 24,
            path: "M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z",
        },
        click: function (gd: HTMLElement, evt: Event) {
            const div = gd.querySelector("div.svg-container") as HTMLDivElement;
            if (!div) {
                return;
            }
            const { height, width } = gd.dataset;
            if (!height) {
                const st = getComputedStyle(div);
                gd.setAttribute("data-height", st.height);
                gd.setAttribute("data-width", st.width);
            }
            const fs = gd.classList.toggle("full-screen");
            (evt.currentTarget as HTMLElement).setAttribute("data-title", fs ? "Exit Full screen" : "Full screen");
            if (!fs) {
                // height && div.attributeStyleMap.set("height", height);
                height && (div.style.height = height);
                // width && div.attributeStyleMap.set("width", width);
                width && (div.style.width = width);
            }
            window.dispatchEvent(new Event("resize"));
        },
    },
];

const updateArrays = (sel: number[][], val: number[], idx: number) => {
    if (idx >= sel.length || val.length !== sel[idx].length || val.some((v, i) => sel[idx][i] != v)) {
        sel = sel.concat(); // shallow copy
        sel[idx] = val;
    }
    return sel;
};

const getDataKey = (columns?: Record<string, ColumnDesc>, decimators?: string[]): [string[], string] => {
    const backCols = columns ? Object.values(columns).map((col) => col.dfid) : [];
    return [backCols, backCols.join("-") + (decimators ? `--${decimators.join("")}` : "")];
};

const isDataRefresh = (data?: Record<string, TraceValueType>) => data?.__taipy_refresh !== undefined;
const getDataVarName = (updateVarName: string | undefined, dataVarNames: string[], idx: number) =>
    idx === 0 ? updateVarName : dataVarNames[idx - 1];
const getData = (
    data: Record<string, TraceValueType>,
    additionalDatas: Array<Record<string, TraceValueType>>,
    idx: number
) => (idx === 0 ? data : idx <= additionalDatas.length ? additionalDatas[idx - 1] : undefined);

const Chart = (props: ChartProp) => {
    const {
        title = "",
        width = "100%",
        height,
        updateVarName,
        updateVars,
        id,
        data = emptyData,
        onRangeChange,
        propagate = true,
        onClick,
    } = props;
    const dispatch = useDispatch();
    const [selected, setSelected] = useState<number[][]>([]);
    const plotRef = useRef<HTMLDivElement>(null);
    const [dataKeys, setDataKeys] = useState<string[]>([]);
    const lastDataPl = useRef<Data[]>([]);
    const theme = useTheme();
    const module = useModule();

    const className = useClassNames(props.libClassName, props.dynamicClassName, props.className);
    const active = useDynamicProperty(props.active, props.defaultActive, true);
    const render = useDynamicProperty(props.render, props.defaultRender, true);
    const hover = useDynamicProperty(props.hoverText, props.defaultHoverText, undefined);
    const baseLayout = useDynamicJsonProperty(props.layout, props.defaultLayout || "", emptyLayout);

    const dataVarNames = useMemo(() => (props.dataVarNames ? props.dataVarNames.split(";") : []), [props.dataVarNames]);
    const oldAdditionalDatas = useRef<Array<Record<string, TraceValueType>>>([]);
    const additionalDatas = useMemo(() => {
        const newAdditionalDatas = dataVarNames.map(
            (_, idx) => (props as unknown as Record<string, Record<string, TraceValueType>>)[`data${idx + 1}`]
        );
        if (newAdditionalDatas.length !== oldAdditionalDatas.current.length) {
            oldAdditionalDatas.current = newAdditionalDatas;
        } else if (!newAdditionalDatas.every((d, idx) => d === oldAdditionalDatas.current[idx])) {
            oldAdditionalDatas.current = newAdditionalDatas;
        }
        return oldAdditionalDatas.current;
    }, [dataVarNames, props]);

    const refresh = useMemo(
        () => (isDataRefresh(data) || additionalDatas.some((d) => isDataRefresh(d)) ? nanoid() : false),
        [data, additionalDatas]
    );

    // get props.selected[i] values
    useEffect(() => {
        if (props.figure) {
            return;
        }
        setSelected((sel) => {
            Object.keys(props).forEach((key) => {
                const res = selectedPropRe.exec(key);
                if (res && res.length == 2) {
                    const idx = parseInt(res[1], 10);
                    let val = (props as unknown as Record<string, number[]>)[key];
                    if (val !== undefined) {
                        if (typeof val === "string") {
                            try {
                                val = JSON.parse(val) as number[];
                            } catch {
                                // too bad
                                val = [];
                            }
                        }
                        if (!Array.isArray(val)) {
                            val = [];
                        }
                        if (idx === 0 && val.length && Array.isArray(val[0])) {
                            for (let i = 0; i < val.length; i++) {
                                sel = updateArrays(sel, val[i] as unknown as number[], i);
                            }
                        } else {
                            sel = updateArrays(sel, val, idx);
                        }
                    }
                }
            });
            return sel;
        });
    }, [props]);

    const config = useDynamicJsonProperty(props.config, props.defaultConfig, defaultConfig);

    useEffect(() => {
        setDataKeys((oldDtKeys) => {
            let changed = false;
            const newDtKeys = (config.columns || []).map((columns, idx) => {
                const varName = getDataVarName(updateVarName, dataVarNames, idx);
                if (varName) {
                    const [backCols, dtKey] = getDataKey(columns, config.decimators);
                    changed = changed || idx > oldDtKeys.length || oldDtKeys[idx] !== dtKey;
                    const lData = getData(data, additionalDatas, idx);
                    if (lData === undefined || isDataRefresh(lData) || !lData[dtKey]) {
                        Promise.resolve().then(() =>
                            dispatch(
                                createRequestChartUpdateAction(
                                    varName,
                                    id,
                                    module,
                                    backCols,
                                    dtKey,
                                    getDecimatorsPayload(
                                        config.decimators,
                                        plotRef.current,
                                        config.modes,
                                        columns,
                                        config.traces
                                    )
                                )
                            )
                        );
                    }
                    return dtKey;
                }
                return "";
            });
            return changed ? newDtKeys : oldDtKeys;
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
        refresh,
        dispatch,
        config.columns,
        config.traces,
        config.modes,
        config.decimators,
        updateVarName,
        dataVarNames,
        id,
        module,
    ]);

    useDispatchRequestUpdateOnFirstRender(dispatch, id, module, updateVars);

    const layout = useMemo(() => {
        const layout = { ...baseLayout };
        let template = undefined;
        try {
            const tpl = props.template && JSON.parse(props.template);
            const tplTheme =
                theme.palette.mode === "dark"
                    ? props.template_Dark_
                        ? JSON.parse(props.template_Dark_)
                        : darkThemeTemplate
                    : props.template_Light_ && JSON.parse(props.template_Light_);
            template = tpl ? (tplTheme ? { ...tpl, ...tplTheme } : tpl) : tplTheme ? tplTheme : undefined;
        } catch (e) {
            console.info(`Error while parsing Chart.template\n${(e as Error).message || e}`);
        }
        if (template) {
            layout.template = template;
        }
        if (props.figure) {
            return merge({}, props.figure[0].layout as Partial<Layout>, layout, {
                title: title || layout.title || (props.figure[0].layout as Partial<Layout>).title,
                clickmode: "event+select",
            });
        }
        return {
            ...layout,
            autosize: true,
            title: title || layout.title,
            xaxis: {
                title:
                    config.traces.length && config.traces[0].length && config.traces[0][0]
                        ? getColNameFromIndexed(config.columns[0][config.traces[0][0]]?.dfid)
                        : undefined,
                ...layout.xaxis,
            },
            yaxis: {
                title:
                    config.traces.length == 1 && config.traces[0].length > 1 && config.columns[0][config.traces[0][1]]
                        ? getColNameFromIndexed(config.columns[0][config.traces[0][1]]?.dfid)
                        : undefined,
                ...layout.yaxis,
            },
            clickmode: "event+select",
        } as Layout;
    }, [
        theme.palette.mode,
        title,
        config.columns,
        config.traces,
        baseLayout,
        props.template,
        props.template_Dark_,
        props.template_Light_,
        props.figure,
    ]);

    const style = useMemo(
        () =>
            height === undefined
                ? ({ ...defaultStyle, width: width } as CSSProperties)
                : ({ ...defaultStyle, width: width, height: height } as CSSProperties),
        [width, height]
    );
    const skelStyle = useMemo(() => ({ ...style, minHeight: "7em" }), [style]);

    const dataPl = useMemo(() => {
        if (props.figure) {
            return lastDataPl.current || [];
        }
        const dataList = dataKeys.map((_, idx) => getData(data, additionalDatas, idx));
        if (!dataList.length || dataList.every((d) => !d || isDataRefresh(d) || !Object.keys(d).length)) {
            return lastDataPl.current || [];
        }
        let changed = false;
        let baseDataPl = (lastDataPl.current.length && lastDataPl.current[0]) || {};
        const newDataPl = config.traces.map((trace, idx) => {
            const currentData = (idx < lastDataPl.current.length && lastDataPl.current[idx]) || baseDataPl;
            const dataKey = idx < dataKeys.length ? dataKeys[idx] : dataKeys[0];
            const lData = (idx < dataList.length && dataList[idx]) || dataList[0];
            if (!lData || isDataRefresh(lData) || !Object.keys(lData).length) {
                return currentData;
            }
            const dtKey = getDataKey(
                idx < config.columns?.length ? config.columns[idx] : undefined,
                config.decimators
            )[1];
            if (!dataKey.startsWith(dtKey)) {
                return currentData;
            }
            changed = true;
            const datum = lData[dataKey];
            const columns = config.columns[idx] || config.columns[0];
            const ret = {
                ...getArrayValue(config.options, idx, {}),
                type: config.types[idx],
                mode: config.modes[idx],
                name:
                    getArrayValue(config.names, idx) ||
                    (columns[trace[1]] ? getColNameFromIndexed(columns[trace[1]].dfid) : undefined),
            } as Record<string, unknown>;
            ret.marker = { ...getArrayValue(config.markers, idx, ret.marker || {}) };
            if (Object.keys(ret.marker as object).length) {
                MARKER_TO_COL.forEach((prop) => {
                    const val = (ret.marker as Record<string, unknown>)[prop];
                    if (typeof val === "string") {
                        const arr = getValueFromCol(datum, val as string);
                        if (arr.length) {
                            (ret.marker as Record<string, unknown>)[prop] = arr;
                        }
                    }
                });
            } else {
                delete ret.marker;
            }
            const xs = getValue(datum, trace, 0) || [];
            const ys = getValue(datum, trace, 1) || [];
            const addIndex = getArrayValue(config.addIndex, idx, true) && !ys.length;
            const baseX = addIndex ? Array.from(Array(xs.length).keys()) : xs;
            const baseY = addIndex ? xs : ys;
            const axisNames = config.axisNames.length > idx ? config.axisNames[idx] : ([] as string[]);
            if (baseX.length) {
                if (axisNames.length > 0) {
                    ret[axisNames[0]] = baseX;
                } else {
                    ret.x = baseX;
                }
            }
            if (baseY.length) {
                if (axisNames.length > 1) {
                    ret[axisNames[1]] = baseY;
                } else {
                    ret.y = baseY;
                }
            }
            const baseZ = getValue(datum, trace, 2, true);
            if (baseZ) {
                if (axisNames.length > 2) {
                    ret[axisNames[2]] = baseZ;
                } else {
                    ret.z = baseZ;
                }
            }
            // Hack for treemap charts: create a fallback 'parents' column if needed
            // This works ONLY because 'parents' is the third named axis
            // (see __CHART_AXIS in gui/utils/chart_config_builder.py)
            else if (config.types[idx] === "treemap" && Array.isArray(ret.labels)) {
                ret.parents = Array(ret.labels.length).fill("");
            }
            // Other axis
            for (let i = 3; i < axisNames.length; i++) {
                ret[axisNames[i]] = getValue(datum, trace, i, true);
            }
            ret.text = getValue(datum, config.texts, idx, true);
            ret.xaxis = config.xaxis[idx];
            ret.yaxis = config.yaxis[idx];
            ret.hovertext = getValue(datum, config.labels, idx, true);
            const selPoints = getArrayValue(selected, idx, []);
            if (selPoints?.length) {
                ret.selectedpoints = selPoints;
            }
            ret.orientation = getArrayValue(config.orientations, idx);
            ret.line = getArrayValue(config.lines, idx);
            ret.textposition = getArrayValue(config.textAnchors, idx);
            const selectedMarker = getArrayValue(config.selectedMarkers, idx);
            if (selectedMarker) {
                ret.selected = { marker: selectedMarker };
            }
            if (idx == 0) {
                baseDataPl = ret;
            }
            return ret as Data;
        });
        if (changed) {
            lastDataPl.current = newDataPl;
        }
        return lastDataPl.current;
    }, [props.figure, selected, data, additionalDatas, config, dataKeys]);

    const plotConfig = useMemo(() => {
        let plConf: Partial<Config> = {};
        if (props.plotConfig) {
            try {
                plConf = JSON.parse(props.plotConfig);
            } catch (e) {
                console.info(`Error while parsing Chart.plot_config\n${(e as Error).message || e}`);
            }
            if (typeof plConf !== "object" || plConf === null || Array.isArray(plConf)) {
                console.info("Error Chart.plot_config is not a dictionary");
                plConf = {};
            }
        }
        plConf.displaylogo = !!plConf.displaylogo;
        plConf.modeBarButtonsToAdd = TaipyPlotlyButtons;
        // plConf.responsive = true; // this is the source of the on/off height ...
        plConf.autosizable = true;
        if (!active) {
            plConf.staticPlot = true;
        }
        return plConf;
    }, [active, props.plotConfig]);

    const onRelayout = useCallback(
        (eventData: PlotRelayoutEvent) => {
            onRangeChange && dispatch(createSendActionNameAction(id, module, { action: onRangeChange, ...eventData }));
            if (config.decimators && !config.types.includes("scatter3d")) {
                const [backCols, dtKeyBase] = getDataKey(
                    config.columns?.length ? config.columns[0] : undefined,
                    config.decimators
                );
                const dtKey = `${dtKeyBase}--${Object.entries(eventData)
                    .map(([k, v]) => `${k}=${v}`)
                    .join("-")}`;
                setDataKeys((oldDataKeys) => {
                    if (oldDataKeys.length === 0) {
                        return [dtKey];
                    }
                    if (oldDataKeys[0] !== dtKey) {
                        Promise.resolve().then(() =>
                            dispatch(
                                createRequestChartUpdateAction(
                                    updateVarName,
                                    id,
                                    module,
                                    backCols,
                                    dtKey,
                                    getDecimatorsPayload(
                                        config.decimators,
                                        plotRef.current,
                                        config.modes,
                                        config.columns?.length ? config.columns[0] : {},
                                        config.traces,
                                        eventData
                                    )
                                )
                            )
                        );
                        return [dtKey, ...oldDataKeys.slice(1)];
                    }
                    return oldDataKeys;
                });
            }
        },
        [
            dispatch,
            onRangeChange,
            id,
            config.modes,
            config.columns,
            config.traces,
            config.types,
            config.decimators,
            updateVarName,
            module,
        ]
    );

    const clickHandler = useCallback(
        (evt?: MouseEvent) => {
            const map =
                (evt?.currentTarget as PlotlyDiv)?._fullLayout?.map ||
                (evt?.currentTarget as PlotlyDiv)?._fullLayout?.geo ||
                (evt?.currentTarget as PlotlyDiv)?._fullLayout?.mapbox;
            const xaxis = map ? map._subplot?.xaxis : (evt?.currentTarget as PlotlyDiv)?._fullLayout?.xaxis;
            const yaxis = map ? map._subplot?.xaxis : (evt?.currentTarget as PlotlyDiv)?._fullLayout?.yaxis;
            if (!xaxis || !yaxis) {
                console.info("clickHandler: Plotly div does not have an xaxis object", evt);
                return;
            }
            const transform = (axis: Axis, delta: keyof DOMRect) => {
                const bb = (evt?.target as HTMLDivElement).getBoundingClientRect();
                return (pos?: number) => axis.p2d((pos || 0) - (bb[delta] as number));
            };
            dispatch(
                createSendActionNameAction(
                    id,
                    module,
                    lightenPayload({
                        action: onClick,
                        lat: map ? yaxis.p2c() : undefined,
                        y: map ? undefined : transform(yaxis, "top")(evt?.clientY),
                        lon: map ? xaxis.p2c() : undefined,
                        x: map ? undefined : transform(xaxis, "left")(evt?.clientX),
                    })
                )
            );
        },
        [dispatch, module, id, onClick]
    );

    const onInitialized = useCallback(
        (figure: Readonly<Figure>, graphDiv: Readonly<HTMLElement>) => {
            onClick && graphDiv.addEventListener("click", clickHandler);
        },
        [onClick, clickHandler]
    );

    const getRealIndex = useCallback(
        (dataIdx: number, index?: number) => {
            const lData = getData(data, additionalDatas, dataIdx);
            if (!lData) {
                return index || 0;
            }
            const dtKey = dataKeys[dataIdx];
            return typeof index === "number"
                ? props.figure
                    ? index
                    : lData[dtKey].tp_index
                    ? (lData[dtKey].tp_index[index] as number)
                    : index
                : 0;
        },
        [data, additionalDatas, dataKeys, props.figure]
    );

    const onSelect = useCallback(
        (evt?: PlotSelectionEvent) => {
            if (updateVars) {
                const traces = (evt?.points || []).reduce((tr, pt) => {
                    tr[pt.curveNumber] = tr[pt.curveNumber] || [];
                    tr[pt.curveNumber].push(getRealIndex(pt.curveNumber, getPlotIndex(pt)));
                    return tr;
                }, [] as number[][]);
                if (config.traces.length === 0) {
                    // figure
                    const theVar = getUpdateVar(updateVars, "selected");
                    theVar && dispatch(createSendUpdateAction(theVar, traces, module, props.onChange, propagate));
                    return;
                }
                if (traces.length) {
                    const upvars = traces.map((_, idx) => getUpdateVar(updateVars, `selected${idx}`));
                    const setVars = new Set(upvars.filter((v) => v));
                    if (traces.length > 1 && setVars.size === 1) {
                        dispatch(
                            createSendUpdateAction(
                                setVars.values().next().value,
                                traces,
                                module,
                                props.onChange,
                                propagate
                            )
                        );
                        return;
                    }
                    traces.forEach((tr, idx) => {
                        if (upvars[idx] && tr && tr.length) {
                            dispatch(createSendUpdateAction(upvars[idx], tr, module, props.onChange, propagate));
                        }
                    });
                } else if (config.traces.length === 1) {
                    const upVar = getUpdateVar(updateVars, "selected0");
                    if (upVar) {
                        dispatch(createSendUpdateAction(upVar, [], module, props.onChange, propagate));
                    }
                }
            }
        },
        [getRealIndex, dispatch, updateVars, propagate, props.onChange, config.traces.length, module]
    );

    return render ? (
        <Tooltip title={hover || ""}>
            <Box id={id} className={`${className} ${getComponentClassName(props.children)}`} ref={plotRef}>
                <Suspense fallback={<Skeleton key="skeleton" sx={skelStyle} />}>
                    {Array.isArray(props.figure) && props.figure.length && props.figure[0].data !== undefined ? (
                        <Plot
                            data={props.figure[0].data as Data[]}
                            layout={layout}
                            style={style}
                            onRelayout={onRelayout}
                            onSelected={onSelect}
                            onDeselect={onSelect}
                            config={plotConfig}
                            useResizeHandler
                            onInitialized={onInitialized}
                        />
                    ) : (
                        <Plot
                            data={dataPl}
                            layout={layout}
                            style={style}
                            onRelayout={onRelayout}
                            onSelected={isOnClick(config.types) ? undefined : onSelect}
                            onDeselect={isOnClick(config.types) ? undefined : onSelect}
                            onClick={isOnClick(config.types) ? onSelect : undefined}
                            config={plotConfig}
                            useResizeHandler
                            onInitialized={onInitialized}
                        />
                    )}
                </Suspense>
                {props.children}
            </Box>
        </Tooltip>
    ) : null;
};

export default Chart;

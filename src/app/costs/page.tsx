"use client";

import { useState, useEffect } from "react";
import { BudgetBar } from "@/components/BudgetBar";

interface CostLogEntry {
  id: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  agentType: string;
  region: string | null;
  createdAt: string;
}

interface CostData {
  dailyCost: number;
  totalCost: number;
  dailyCap: number;
  totalBudget: number;
  costLogs: CostLogEntry[];
}

export default function CostsPage() {
  const [data, setData] = useState<CostData | null>(null);

  useEffect(() => {
    fetch("/api/costs")
      .then((r) => r.json())
      .then(setData)
      .catch(() => {});
  }, []);

  if (!data) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-8">
        <p className="text-text-muted">Loading cost data...</p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <a
        href="/"
        className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-text-secondary mb-6 font-mono"
      >
        &larr; Back
      </a>

      <h1 className="font-display font-bold text-3xl mb-6">Cost Dashboard</h1>

      <div className="mb-8">
        <BudgetBar
          dailyCost={data.dailyCost}
          dailyCap={data.dailyCap}
          totalCost={data.totalCost}
          totalBudget={data.totalBudget}
        />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <div className="bg-surface border border-border rounded-lg p-4">
          <p className="text-xs text-text-muted font-mono mb-1">TODAY</p>
          <p className="text-2xl font-mono font-semibold text-accent-green">
            ${data.dailyCost.toFixed(4)}
          </p>
        </div>
        <div className="bg-surface border border-border rounded-lg p-4">
          <p className="text-xs text-text-muted font-mono mb-1">DAILY CAP</p>
          <p className="text-2xl font-mono font-semibold text-text-secondary">
            ${data.dailyCap.toFixed(2)}
          </p>
        </div>
        <div className="bg-surface border border-border rounded-lg p-4">
          <p className="text-xs text-text-muted font-mono mb-1">ALL TIME</p>
          <p className="text-2xl font-mono font-semibold text-accent-purple">
            ${data.totalCost.toFixed(4)}
          </p>
        </div>
        <div className="bg-surface border border-border rounded-lg p-4">
          <p className="text-xs text-text-muted font-mono mb-1">BUDGET LEFT</p>
          <p className="text-2xl font-mono font-semibold text-text-primary">
            ${(data.totalBudget - data.totalCost).toFixed(2)}
          </p>
        </div>
      </div>

      <h2 className="font-display font-bold text-xl mb-4">Recent API Calls</h2>

      <div className="overflow-x-auto">
        <table className="w-full text-sm font-mono">
          <thead>
            <tr className="border-b border-border text-text-muted text-left">
              <th className="py-2 pr-4">Time</th>
              <th className="py-2 pr-4">Model</th>
              <th className="py-2 pr-4">Agent</th>
              <th className="py-2 pr-4">Region</th>
              <th className="py-2 pr-4 text-right">In</th>
              <th className="py-2 pr-4 text-right">Out</th>
              <th className="py-2 text-right">Cost</th>
            </tr>
          </thead>
          <tbody>
            {data.costLogs.map((log) => (
              <tr
                key={log.id}
                className="border-b border-border/50 text-text-secondary"
              >
                <td className="py-2 pr-4 text-text-muted text-xs">
                  {new Date(log.createdAt).toLocaleString()}
                </td>
                <td className="py-2 pr-4">
                  <span
                    className={`text-xs px-1.5 py-0.5 rounded ${
                      log.model.includes("haiku")
                        ? "bg-accent-blue/10 text-accent-blue"
                        : "bg-accent-purple/10 text-accent-purple"
                    }`}
                  >
                    {log.model.includes("haiku") ? "Haiku" : "Sonnet"}
                  </span>
                </td>
                <td className="py-2 pr-4">{log.agentType}</td>
                <td className="py-2 pr-4 text-text-muted">
                  {log.region || "—"}
                </td>
                <td className="py-2 pr-4 text-right">
                  {log.inputTokens.toLocaleString()}
                </td>
                <td className="py-2 pr-4 text-right">
                  {log.outputTokens.toLocaleString()}
                </td>
                <td className="py-2 text-right text-accent-green">
                  ${log.costUsd.toFixed(4)}
                </td>
              </tr>
            ))}
            {data.costLogs.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  className="py-8 text-center text-text-muted"
                >
                  No API calls yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

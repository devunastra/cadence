"use client";

import { useState, useEffect } from "react";
import { Eye, EyeOff, Trash2 } from "lucide-react";
import { createStudio, deleteStudio } from "@/app/actions";
import { useToast } from "@/components/ui/toast-provider";
import { NOTION_COLORS } from "@/lib/constants";
import { SimpleSelect } from "@/components/simple-select";
import { ConfirmDeleteModal } from "@/components/confirm-delete-modal";
import type { Studio } from "@/lib/types";

interface StudiosFormProps {
    initialStudios: Studio[];
}

const INPUT =
    "w-full px-3 py-2 border border-[var(--color-border)] rounded-lg text-base md:text-sm text-[var(--color-text-primary)] bg-[var(--color-bg)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]";
const LABEL =
    "block text-sm font-medium text-[var(--color-text-secondary)] mb-1";

const US_STATE_OPTIONS = [
    "Alabama",
    "Alaska",
    "Arizona",
    "Arkansas",
    "California",
    "Colorado",
    "Connecticut",
    "Delaware",
    "District of Columbia",
    "Florida",
    "Georgia",
    "Hawaii",
    "Idaho",
    "Illinois",
    "Indiana",
    "Iowa",
    "Kansas",
    "Kentucky",
    "Louisiana",
    "Maine",
    "Maryland",
    "Massachusetts",
    "Michigan",
    "Minnesota",
    "Mississippi",
    "Missouri",
    "Montana",
    "Nebraska",
    "Nevada",
    "New Hampshire",
    "New Jersey",
    "New Mexico",
    "New York",
    "North Carolina",
    "North Dakota",
    "Ohio",
    "Oklahoma",
    "Oregon",
    "Pennsylvania",
    "Rhode Island",
    "South Carolina",
    "South Dakota",
    "Tennessee",
    "Texas",
    "Utah",
    "Vermont",
    "Virginia",
    "Washington",
    "West Virginia",
    "Wisconsin",
    "Wyoming",
].map((s) => ({ value: s, label: s }));

export function StudiosForm({ initialStudios }: StudiosFormProps) {
    const [studios, setStudios] = useState(initialStudios);
    const [name, setName] = useState("");
    const [streetAddress, setStreetAddress] = useState("");
    const [city, setCity] = useState("");
    const [postalCode, setPostalCode] = useState("");
    const [state, setState] = useState("");
    const [country, setCountry] = useState("");
    const [ghlAccountId, setGhlAccountId] = useState("");
    const [ghlApiKey, setGhlApiKey] = useState("");
    const [showGhlApiKey, setShowGhlApiKey] = useState(false);
    const [ghlCalendarId, setGhlCalendarId] = useState("");
    const [retellAgentId, setRetellAgentId] = useState("");
    const [retellApiKey, setRetellApiKey] = useState("");
    const [showApiKey, setShowApiKey] = useState(false);
    const { showError } = useToast();
    const [saving, setSaving] = useState(false);
    const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);
    const [mounted, setMounted] = useState(false);
    useEffect(() => setMounted(true), []);
    if (!mounted) return null;

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        if (!state) {
            showError("State / Prov / Region is required.");
            return;
        }
        setSaving(true);

        try {
            await createStudio({
                name,
                street_address: streetAddress,
                city,
                postal_code: postalCode,
                state,
                country,
                ghl_account_id: ghlAccountId,
                ghl_api_key: ghlApiKey,
                ghl_calendar_id: ghlCalendarId,
                retell_agent_id: retellAgentId,
                retell_api_key: retellApiKey,
            });
            setName("");
            setStreetAddress("");
            setCity("");
            setPostalCode("");
            setState("");
            setCountry("");
            setGhlAccountId("");
            setGhlApiKey("");
            setGhlCalendarId("");
            setRetellAgentId("");
            setRetellApiKey("");
            window.location.reload();
        } catch (err) {
            showError(err instanceof Error ? err.message : "Failed to create studio.");
        } finally {
            setSaving(false);
        }
    }

    async function handleDelete() {
        if (!pendingDelete) return;
        setIsDeleting(true);
        try {
            await deleteStudio(pendingDelete.id);
            setStudios((prev) => prev.filter((s) => s.id !== pendingDelete.id));
            setPendingDelete(null);
            window.location.reload();
        } catch (err) {
            showError(err instanceof Error ? err.message : "Failed to delete studio.");
        } finally {
            setIsDeleting(false);
        }
    }

    return (
        <>
            {pendingDelete && (
                <ConfirmDeleteModal
                    title={`Delete "${pendingDelete.name}"?`}
                    message="Are you sure you want to delete this studio? This action cannot be undone."
                    isDeleting={isDeleting}
                    onConfirm={handleDelete}
                    onCancel={() => setPendingDelete(null)}
                />
            )}
            <div className="space-y-6">
                <div>
                    <h2
                        className="text-xl font-semibold mb-1"
                        style={{ color: "var(--color-text-primary)" }}
                    >
                        Studios
                    </h2>
                    <p
                        className="text-base"
                        style={{ color: "var(--color-text-secondary)" }}
                    >
                        Manage all studios in the system.
                    </p>
                </div>

                {/* Studios list card */}
                <div
                    className="rounded-xl overflow-hidden"
                    style={{
                        backgroundColor: "var(--color-bg)",
                        border: "1px solid var(--color-border)",
                    }}
                >
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm" style={{ minWidth: 500 }}>
                        <thead
                            style={{
                                backgroundColor: "var(--color-surface)",
                                borderBottom: "1px solid var(--color-border)",
                            }}
                        >
                            <tr>
                                <th
                                    className="text-left px-6 py-3 text-sm font-semibold"
                                    style={{ color: "var(--color-text-secondary)" }}
                                >
                                    Name
                                </th>
                                <th
                                    className="text-left px-6 py-3 text-sm font-semibold"
                                    style={{ color: "var(--color-text-secondary)" }}
                                >
                                    Street Address
                                </th>
                                <th
                                    className="text-left px-6 py-3 text-sm font-semibold"
                                    style={{ color: "var(--color-text-secondary)" }}
                                >
                                    City
                                </th>
                                <th className="px-6 py-3" />
                            </tr>
                        </thead>
                        <tbody>
                            {studios.length === 0 ? (
                                <tr>
                                    <td
                                        colSpan={4}
                                        className="px-6 py-8 text-center text-sm"
                                        style={{ color: "var(--color-text-muted)" }}
                                    >
                                        No studios yet.
                                    </td>
                                </tr>
                            ) : (
                                studios.map((studio) => (
                                    <tr
                                        key={studio.id}
                                        style={{
                                            borderTop:
                                                "1px solid var(--color-border)",
                                        }}
                                    >
                                        <td
                                            className="px-6 py-3 font-medium"
                                            style={{
                                                color: "var(--color-text-body)",
                                            }}
                                        >
                                            {studio.name}
                                        </td>
                                        <td
                                            className="px-6 py-3"
                                            style={{
                                                color: "var(--color-text-body)",
                                            }}
                                        >
                                            {studio.street_address || "—"}
                                        </td>
                                        <td
                                            className="px-6 py-3"
                                            style={{
                                                color: "var(--color-text-body)",
                                            }}
                                        >
                                            {studio.city || "—"}
                                        </td>
                                        <td className="py-3 text-center">
                                            <button
                                                type="button"
                                                onClick={() =>
                                                    setPendingDelete({ id: studio.id, name: studio.name })
                                                }
                                                className="p-1 transition-colors"
                                                style={{ color: '#dc2626' }}
                                                onMouseEnter={(e) =>
                                                    ((e.currentTarget as HTMLElement).style.color = "#b91c1c")
                                                }
                                                onMouseLeave={(e) =>
                                                    ((e.currentTarget as HTMLElement).style.color = "#dc2626")
                                                }
                                                title="Delete studio"
                                            >
                                                <Trash2 size={18} />
                                            </button>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                  </div>
                </div>

                {/* Add new studio section */}
                <div className="mt-12">
                    <h3
                        className="text-lg font-semibold mb-1"
                        style={{ color: "var(--color-text-primary)" }}
                    >
                        Add a New Studio
                    </h3>
                    <p
                        className="text-base mb-4"
                        style={{ color: "var(--color-text-secondary)" }}
                    >
                        Fill in the details below to create a new studio.
                    </p>
                </div>
                <form onSubmit={handleSubmit}>
                    <div
                        className="rounded-xl overflow-hidden"
                        style={{
                            backgroundColor: "var(--color-bg)",
                            border: "1px solid var(--color-border)",
                        }}
                    >
                        {/* Studio Name */}
                        <div
                            className="px-6 py-5"
                            style={{
                                borderBottom: "1px solid var(--color-border)",
                            }}
                        >
                            <label className={LABEL}>
                                Studio Name <span className="text-red-500">*</span>
                            </label>
                            <input
                                type="text"
                                required
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder="e.g. My Dance Studio"
                                className={INPUT}
                            />
                        </div>

                        {/* Location */}
                        <div
                            className="px-6 py-5 space-y-4"
                            style={{
                                borderBottom: "1px solid var(--color-border)",
                            }}
                        >
                            <div>
                                <label className={LABEL}>
                                    Street Address{" "}
                                    <span className="text-red-500">*</span>
                                </label>
                                <input
                                    type="text"
                                    required
                                    value={streetAddress}
                                    onChange={(e) =>
                                        setStreetAddress(e.target.value)
                                    }
                                    placeholder="e.g. 175 Olde Half Day Road"
                                    className={INPUT}
                                />
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className={LABEL}>
                                        City <span className="text-red-500">*</span>
                                    </label>
                                    <input
                                        type="text"
                                        required
                                        value={city}
                                        onChange={(e) => setCity(e.target.value)}
                                        placeholder="e.g. Lincolnshire"
                                        className={INPUT}
                                    />
                                </div>
                                <div>
                                    <label className={LABEL}>
                                        Postal / Zip Code{" "}
                                        <span className="text-red-500">*</span>
                                    </label>
                                    <input
                                        type="text"
                                        required
                                        value={postalCode}
                                        onChange={(e) =>
                                            setPostalCode(e.target.value)
                                        }
                                        placeholder="e.g. 60069"
                                        className={INPUT}
                                    />
                                </div>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className={LABEL}>
                                        State / Prov / Region{" "}
                                        <span className="text-red-500">*</span>
                                    </label>
                                    <SimpleSelect
                                        value={state}
                                        onChange={setState}
                                        options={US_STATE_OPTIONS}
                                        placeholder="Select State"
                                        fullWidth
                                        triggerBg="var(--color-bg)"
                                        triggerClassName="py-2"
                                    />
                                </div>
                                <div>
                                    <label className={LABEL}>
                                        Country{" "}
                                        <span className="text-red-500">*</span>
                                    </label>
                                    <input
                                        type="text"
                                        required
                                        value={country}
                                        onChange={(e) => setCountry(e.target.value)}
                                        placeholder="e.g. United States"
                                        className={INPUT}
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Integrations */}
                        <div
                            className="px-6 py-5 space-y-4"
                            style={{
                                borderBottom: "1px solid var(--color-border)",
                            }}
                        >
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className={LABEL}>GHL Account ID</label>
                                    <input
                                        type="text"
                                        value={ghlAccountId}
                                        onChange={(e) =>
                                            setGhlAccountId(e.target.value)
                                        }
                                        placeholder="GHL sub-account ID"
                                        className={INPUT}
                                    />
                                </div>
                                <div>
                                    <label className={LABEL}>GHL Calendar ID</label>
                                    <input
                                        type="text"
                                        value={ghlCalendarId}
                                        onChange={(e) =>
                                            setGhlCalendarId(e.target.value)
                                        }
                                        placeholder="e.g. TYARmrJpYZIj4lGbA9iS"
                                        className={INPUT}
                                    />
                                </div>
                            </div>
                            <div>
                                <label className={LABEL}>GHL API Key</label>
                                <div className="relative">
                                    <input
                                        type={showGhlApiKey ? "text" : "password"}
                                        value={ghlApiKey}
                                        onChange={(e) =>
                                            setGhlApiKey(e.target.value)
                                        }
                                        placeholder="pit-••••••••••••••••"
                                        className={INPUT + " pr-10"}
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowGhlApiKey((v) => !v)}
                                        className="absolute right-2.5 top-1/2 -translate-y-1/2 transition-colors"
                                        style={{ color: "var(--color-text-muted)" }}
                                        onMouseEnter={(e) =>
                                        ((
                                            e.currentTarget as HTMLElement
                                        ).style.color =
                                            "var(--color-text-secondary)")
                                        }
                                        onMouseLeave={(e) =>
                                        ((
                                            e.currentTarget as HTMLElement
                                        ).style.color =
                                            "var(--color-text-muted)")
                                        }
                                    >
                                        {showGhlApiKey ? (
                                            <EyeOff className="w-4 h-4" />
                                        ) : (
                                            <Eye className="w-4 h-4" />
                                        )}
                                    </button>
                                </div>
                                <p className="mt-1 text-xs" style={{ color: 'var(--color-text-muted)' }}>Private Integration API Key for this GHL sub-account.</p>
                            </div>
                            <div>
                                <label className={LABEL}>Retell Agent ID</label>
                                <input
                                    type="text"
                                    value={retellAgentId}
                                    onChange={(e) =>
                                        setRetellAgentId(e.target.value)
                                    }
                                    placeholder="Retell agent ID"
                                    className={INPUT}
                                />
                            </div>
                            <div>
                                <label className={LABEL}>Retell API Key</label>
                                <div className="relative">
                                    <input
                                        type={showApiKey ? "text" : "password"}
                                        value={retellApiKey}
                                        onChange={(e) =>
                                            setRetellApiKey(e.target.value)
                                        }
                                        placeholder="key_••••••••••••••••"
                                        className={INPUT + " pr-10"}
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowApiKey((v) => !v)}
                                        className="absolute right-2.5 top-1/2 -translate-y-1/2 transition-colors"
                                        style={{ color: "var(--color-text-muted)" }}
                                        onMouseEnter={(e) =>
                                        ((
                                            e.currentTarget as HTMLElement
                                        ).style.color =
                                            "var(--color-text-secondary)")
                                        }
                                        onMouseLeave={(e) =>
                                        ((
                                            e.currentTarget as HTMLElement
                                        ).style.color =
                                            "var(--color-text-muted)")
                                        }
                                    >
                                        {showApiKey ? (
                                            <EyeOff className="w-4 h-4" />
                                        ) : (
                                            <Eye className="w-4 h-4" />
                                        )}
                                    </button>
                                </div>
                            </div>
                        </div>

                        {/* Footer */}
                        <div
                            className="px-6 py-4 flex items-center justify-end gap-3"
                            style={{ backgroundColor: "var(--color-surface)" }}
                        >
                            <button
                                type="submit"
                                disabled={saving}
                                className="px-5 py-2 text-sm font-medium text-white rounded-lg disabled:opacity-60 transition-opacity hover:opacity-90"
                                style={{ backgroundColor: "var(--color-accent)" }}
                            >
                                {saving ? "Creating…" : "Create Studio"}
                            </button>
                        </div>
                    </div>
                </form>
            </div>
        </>
    );
}

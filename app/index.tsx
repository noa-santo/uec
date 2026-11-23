import { FlatList, Pressable, Text, TextInput, View, useWindowDimensions, ActivityIndicator, Platform } from "react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { Email, groupByToAddress, saveUnresolvedAddresses, unresolvedAddressesFromEmails } from "@/lib/email_utils";
import { getAccounts, GmailAccount, MailAccount } from "@/lib/accounts";
import { fetchAllEmailsFromAccounts, fetchOlderGmailEmails } from "@/lib/gmail";
import { loadAliasRules } from "@/lib/alias_rules";
import { InboxFolder, folderInboxNames, folderMessages, loadInboxFolders, saveInboxFolders } from "@/lib/inbox_folders";
import { DEFAULT_INBOX_LAYOUT, InboxLayout, loadInboxLayout, saveInboxLayout } from "@/lib/ui_layout";
import { subscribeToSettings } from "@/lib/settings_events";
import { HtmlViewer } from "@/components/HtmlViewer";
import { FadeSlideIn } from "@/components/animations";
import TypewriterText from "@/components/TypewriterText";

type InboxSort = "name" | "count" | "newest";

function Heading(props: any) {
  return (
    <Text
      {...props}
      style={[
        { color: "#fff", fontFamily: "Bitcount, system-ui, sans-serif" },
        { letterSpacing: 0.5, textShadowColor: "rgba(255,255,255,0.15)", textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 1 },
        props.style,
      ]}
    />
  );
}

function T(props: any) {
  return (
    <Text
      {...props}
      style={[
        { color: "#fff" },
        { letterSpacing: 0.3, textShadowColor: "rgba(255,255,255,0.1)", textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 1 },
        props.style,
      ]}
    />
  );
}

function Wireframe() {
  return (
    <View style={{ flex: 1, justifyContent: "center", alignItems: "center", opacity: 0.3 }}>
      <View style={{ width: "90%", height: 40, backgroundColor: "#222", borderRadius: 8, marginBottom: 16 }} />
      <View style={{ width: "90%", height: 60, backgroundColor: "#222", borderRadius: 8, marginBottom: 8 }} />
      <View style={{ width: "90%", height: 60, backgroundColor: "#222", borderRadius: 8, marginBottom: 8 }} />
      <View style={{ width: "90%", height: 60, backgroundColor: "#222", borderRadius: 8, marginBottom: 8 }} />
      <View style={{ width: "90%", height: 60, backgroundColor: "#222", borderRadius: 8, marginBottom: 8 }} />
    </View>
  );
}

/** Web-only drag handle. Native layouts use the collapse buttons instead. */
function ColumnResizer({ onResize }: { onResize: (event: any) => void }) {
  if (Platform.OS !== "web") return null;
  return (
    <View
      style={{ width: 6, backgroundColor: "#111", cursor: "col-resize" } as any}
      {...({ onMouseDown: onResize } as any)}
    />
  );
}

export default function Index() {
  const [accounts, setAccounts] = useState<MailAccount[]>([]);
  const [items, setItems] = useState<Email[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [aliasRules, setAliasRules] = useState<Awaited<ReturnType<typeof loadAliasRules>>>([]);
  const [folders, setFolders] = useState<InboxFolder[]>([]);
  const [collapsedFolders, setCollapsedFolders] = useState<string[]>([]);
  const [olderLoading, setOlderLoading] = useState(false);
  const [hasOlder, setHasOlder] = useState(true);

  const [layout, setLayout] = useState<InboxLayout>(DEFAULT_INBOX_LAYOUT);
  const [inboxSearch, setInboxSearch] = useState("");
  const [inboxSort, setInboxSort] = useState<InboxSort>("name");
  const [inboxSortDesc, setInboxSortDesc] = useState(false);
  const [selectedAddress, setSelectedAddress] = useState<string | null>(null);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);
  const [messageSearch, setMessageSearch] = useState("");
  const [messageSort, setMessageSort] = useState<"newest" | "oldest" | "sender" | "subject">("newest");

  const { width } = useWindowDimensions();
  const isNarrow = width < 900;

  const accountSignature = useRef<string | null>(null);

  const reloadSettings = useCallback(async () => {
    const [accs, rules, savedFolders] = await Promise.all([getAccounts(), loadAliasRules(), loadInboxFolders()]);
    setAccounts(accs);
    setAliasRules(rules);
    setFolders(savedFolders);
    setCollapsedFolders(savedFolders.filter((folder) => folder.collapsed).map((folder) => folder.id));
    const signature = accs.map((account) => account.id).sort().join(",");
    if (accountSignature.current !== null && signature !== accountSignature.current) {
      // An account was added or removed while we were on another screen.
      void fetchAllEmailsFromAccounts(accs, (_account, pageEmails, more, syncing) => {
        setOlderLoading(syncing);
        setHasOlder(more);
        setItems((current) => {
          const ids = new Set(current.map((email) => email.id));
          return [...current, ...pageEmails.filter((email) => !ids.has(email.id))];
        });
      }).then((emails) => setItems(emails)).catch((e: any) => setError(String(e?.message || e)));
    }
    accountSignature.current = signature;
  }, []);

  const loadEmails = useCallback(async (accs: MailAccount[]) => {
    try {
      setLoading(true);
      const emails = await fetchAllEmailsFromAccounts(accs, (_account, pageEmails, more, syncing) => {
        setOlderLoading(syncing);
        setHasOlder(more);
        setItems((current) => {
          const ids = new Set(current.map((email) => email.id));
          return [...current, ...pageEmails.filter((email) => !ids.has(email.id))];
        });
      });
      setItems(emails);
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadInboxLayout().then(setLayout); }, []);

  // Stack screens are kept mounted, so reload on every focus and whenever a
  // settings persister (node editor / accounts screen) signals a change.
  useFocusEffect(useCallback(() => { void reloadSettings(); }, [reloadSettings]));
  useEffect(() => subscribeToSettings(() => { void reloadSettings(); }), [reloadSettings]);

  useEffect(() => {
    (async () => {
      const accs = await getAccounts();
      accountSignature.current = accs.map((account) => account.id).sort().join(",");
      await Promise.all([reloadSettings(), loadEmails(accs)]);
    })();
  }, [loadEmails, reloadSettings]);

  // Keep resolver suggestions in sync with every page loaded, including older mail.
  useEffect(() => {
    if (loading) return;
    const timer = setTimeout(() => void saveUnresolvedAddresses(unresolvedAddressesFromEmails(items, aliasRules)), 500);
    return () => clearTimeout(timer);
  }, [items, aliasRules, loading]);

  const groups = useMemo(() => groupByToAddress(items, aliasRules), [items, aliasRules]);

  const folderMap = useMemo(() => {
    const map = new Map<string, { folder: InboxFolder; inboxes: string[]; messages: Email[] }>();
    for (const folder of folders) {
      const inboxes = folderInboxNames(folder, groups, aliasRules);
      map.set(folder.id, { folder, inboxes, messages: folderMessages(folder, groups, aliasRules) });
    }
    return map;
  }, [folders, groups, aliasRules]);

  const addresses = useMemo(() => {
    const latest = (name: string) => groups[name]?.reduce((max, email) => Math.max(max, new Date(email.date).getTime()), 0) ?? 0;
    return Object.keys(groups).sort((a, b) => {
      const comparison = inboxSort === "count"
        ? groups[b].length - groups[a].length || a.localeCompare(b)
        : inboxSort === "newest"
          ? latest(b) - latest(a) || a.localeCompare(b)
          : a.localeCompare(b);
      return inboxSortDesc ? -comparison : comparison;
    });
  }, [groups, inboxSort, inboxSortDesc]);

  const navItems = useMemo(() => {
    const term = inboxSearch.trim().toLowerCase();
    const matches = (name: string) => !term || name.toLowerCase().includes(term);
    const assigned = new Set<string>();
    const items: Array<{ type: "folder"; id: string; name: string; inboxes: string[]; count: number } | { type: "inbox"; address: string; folderId?: string }> = [];

    for (const { folder, inboxes, messages } of folderMap.values()) {
      inboxes.forEach((name) => assigned.add(name.toLowerCase()));
      const children = addresses.filter((address) => inboxes.some((name) => name.toLowerCase() === address.toLowerCase()) && matches(address));
      if (!matches(folder.name) && children.length === 0) continue;
      items.push({ type: "folder", id: folder.id, name: folder.name, inboxes, count: messages.length });
      if (!collapsedFolders.includes(folder.id)) {
        for (const address of children) items.push({ type: "inbox", address, folderId: folder.id });
      }
    }
    for (const address of addresses) {
      if (!assigned.has(address.toLowerCase()) && matches(address)) items.push({ type: "inbox", address });
    }
    return items;
  }, [folderMap, addresses, collapsedFolders, inboxSearch]);

  useEffect(() => {
    if (selectedFolderId) return;
    if (!selectedAddress || !addresses.includes(selectedAddress)) setSelectedAddress(addresses[0] ?? null);
  }, [addresses, selectedAddress, selectedFolderId]);

  const selectedFolder = selectedFolderId ? folderMap.get(selectedFolderId) : undefined;
  const messages = useMemo(() => {
    const source = selectedFolder ? selectedFolder.messages : selectedAddress ? groups[selectedAddress] || [] : [];
    const term = messageSearch.trim().toLowerCase();
    const filtered = source.filter((email) => !term || [email.subject, email.from, email.to, email.snippet].some((part) => part.toLowerCase().includes(term)));
    return [...filtered].sort((a, b) => messageSort === "oldest" ? a.date.localeCompare(b.date) : messageSort === "sender" ? a.from.localeCompare(b.from) : messageSort === "subject" ? a.subject.localeCompare(b.subject) : b.date.localeCompare(a.date));
  }, [selectedFolder, selectedAddress, groups, messageSearch, messageSort]);
  const selectedMessage = useMemo(() => messages.find((m) => m.id === selectedMessageId) ?? null, [messages, selectedMessageId]);

  useEffect(() => {
    if (!messages.some((message) => message.id === selectedMessageId)) {
      setSelectedMessageId(messages[0]?.id ?? null);
    }
  }, [messages, selectedMessageId]);

  const hasOnlyManualAccounts = accounts.length > 0 && accounts.every((a) => a.type === "manual");

  const updateLayout = (patch: Partial<InboxLayout>) => {
    setLayout((current) => {
      const next = { ...current, ...patch };
      void saveInboxLayout(next);
      return next;
    });
  };

  const toggleInboxFolder = (folderId: string) => {
    const collapse = !collapsedFolders.includes(folderId);
    const next = folders.map((folder) => folder.id === folderId ? { ...folder, collapsed: collapse } : folder);
    setCollapsedFolders((current) => collapse ? [...current, folderId] : current.filter((id) => id !== folderId));
    setFolders(next);
    void saveInboxFolders(next);
  };

  const startResize = (column: "inboxesWidth" | "messagesWidth") => (event: any) => {
    if (Platform.OS !== "web" || isNarrow) return;
    event?.preventDefault?.();
    const startX = event?.clientX ?? event?.nativeEvent?.clientX ?? 0;
    const initial = layout[column];
    const onMove = (moveEvent: MouseEvent) => {
      const nextWidth = Math.max(180, Math.min(720, initial + moveEvent.clientX - startX));
      setLayout((current) => ({ ...current, [column]: nextWidth }));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      setLayout((current) => { void saveInboxLayout(current); return current; });
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const loadOlderManually = async () => {
    const gmail = accounts.find((account): account is GmailAccount => account.type === "gmail");
    if (!gmail || olderLoading || !hasOlder) return;
    setOlderLoading(true);
    try {
      const page = await fetchOlderGmailEmails(gmail, undefined, 1, (pageEmails, more) => {
        setHasOlder(more);
        setItems((current) => {
          const ids = new Set(current.map((email) => email.id));
          return [...current, ...pageEmails.filter((email) => !ids.has(email.id))];
        });
      });
      if (!page.length) setHasOlder(false);
    } catch (e: any) {
      setError(`Could not load older email: ${String(e?.message || e)}`);
    } finally {
      setOlderLoading(false);
    }
  };

  const columnStyle = (key: "inboxesWidth" | "messagesWidth") =>
    isNarrow ? { width: "100%" as const } : { width: layout[key] };

  const collapsedRail = (label: string, onExpand: () => void) => (
    <View style={{ width: isNarrow ? "100%" : 36, alignItems: "center", paddingVertical: 10, borderRightWidth: isNarrow ? 0 : 1, borderRightColor: "#111" }}>
      <Pressable onPress={onExpand} style={{ padding: 8, borderWidth: 1, borderColor: "#333", borderRadius: 8 }}><T>{label}</T></Pressable>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: "#000", margin: 10 }}>
      {loading && (
        <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
          <Wireframe />
          <ActivityIndicator size="large" color="#fff" style={{ position: "absolute", top: "50%", left: "50%", marginLeft: -20, marginTop: -20 }} />
          <TypewriterText
            text="Loading emails…"
            startDelayMs={50}
            speedMsPerChar={12}
            pauseAtEndMs={0}
            style={{ marginTop: 12, color: "#aaa", fontFamily: Platform.OS === "web" ? "Bitcount, system-ui, sans-serif" : undefined, fontSize: 18 }}
          />
        </View>
      )}
      {!!error && (
        <View style={{ padding: 8, backgroundColor: "#200", borderRadius: 8, borderWidth: 1, borderColor: "#400", marginBottom: 8 }}>
          <T style={{ color: "#faa" }}>Error: {error}</T>
        </View>
      )}
      {!loading && !error && items.length === 0 && (
        <View style={{ padding: 16, backgroundColor: "#0a0a0a", borderRadius: 8, borderWidth: 1, borderColor: "#222", marginBottom: 8 }}>
          {accounts.length === 0 ? (
            <T>No accounts configured yet. Add your account via the Accounts button in the header.</T>
          ) : hasOnlyManualAccounts ? (
            <View>
              <T style={{ fontWeight: "700", marginBottom: 4 }}>Manual IMAP/POP Account Configured</T>
              <T style={{ color: "#aaa", lineHeight: 20 }}>
                {accounts.length} manual account(s) saved ({accounts.map((a) => (a.type === "manual" ? a.incoming.username : "")).filter(Boolean).join(", ")}). Direct TCP/TLS socket connections for IMAP/POP3 are not supported in React Native/Web without a native TCP proxy or backend sync daemon. Currently, live fetching is implemented for Gmail accounts via REST API.
              </T>
            </View>
          ) : (
            <T>No emails found in connected accounts.</T>
          )}
        </View>
      )}
      {!loading && (
        <View style={{ flex: 1, flexDirection: isNarrow ? "column" : "row" }}>
          {layout.collapsedInboxes
            ? collapsedRail("▸", () => updateLayout({ collapsedInboxes: false }))
            : (
              <FadeSlideIn delay={80} style={[columnStyle("inboxesWidth"), { borderRightWidth: isNarrow ? 0 : 1, borderRightColor: "#111", padding: 8 }]}>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                  <Heading style={{ fontSize: 20, fontWeight: "700", marginBottom: 8 }}>
                    <TypewriterText text="Virtual Inboxes" startDelayMs={200} pauseAtEndMs={0} />
                  </Heading>
                  <Pressable onPress={() => updateLayout({ collapsedInboxes: true })} accessibilityLabel="Collapse inboxes column"><T style={{ color: "#888", paddingHorizontal: 6 }}>‹</T></Pressable>
                </View>

                <View style={{ flexDirection: "row", gap: 6, marginBottom: 6 }}>
                  <TextInput
                    value={inboxSearch}
                    onChangeText={setInboxSearch}
                    placeholder="Filter inboxes and folders"
                    placeholderTextColor="#666"
                    style={{ flex: 1, minWidth: 0, backgroundColor: "#0a0a0a", borderColor: "#252525", borderWidth: 1, borderRadius: 7, padding: 8, color: "#fff" }}
                  />
                </View>
                <View style={{ flexDirection: "row", gap: 6, marginBottom: 8 }}>
                  <Pressable onPress={() => setInboxSort((sort) => sort === "name" ? "count" : sort === "count" ? "newest" : "name")} style={{ borderWidth: 1, borderColor: "#333", borderRadius: 7, paddingHorizontal: 10, justifyContent: "center", minHeight: 32 }}>
                    <T style={{ fontSize: 12 }}>Sort: {inboxSort === "name" ? "Name" : inboxSort === "count" ? "Messages" : "Newest"}</T>
                  </Pressable>
                  <Pressable onPress={() => setInboxSortDesc((desc) => !desc)} style={{ borderWidth: 1, borderColor: "#333", borderRadius: 7, paddingHorizontal: 10, justifyContent: "center", minHeight: 32 }}>
                    <T style={{ fontSize: 12 }}>{inboxSortDesc ? "↓ Desc" : "↑ Asc"}</T>
                  </Pressable>
                </View>

                {!!accounts.some((account) => account.type === "gmail") && <Pressable disabled={olderLoading || !hasOlder} onPress={loadOlderManually} style={{ padding: 9, borderWidth: 1, borderColor: "#333", borderRadius: 8, marginBottom: 8, backgroundColor: "#101010", opacity: olderLoading || !hasOlder ? 0.55 : 1 }}><T style={{ textAlign: "center", fontWeight: "600" }}>{olderLoading ? "Syncing older messages…" : hasOlder ? "Load older messages" : "All available messages loaded"}</T></Pressable>}
                <FlatList
                  data={navItems}
                  keyExtractor={(item) => item.type === "folder" ? `folder:${item.id}` : `inbox:${item.address}:${item.folderId || ""}`}
                  ItemSeparatorComponent={() => <View style={{ height: 6 }} />}
                  renderItem={({ item: navItem }) => {
                    if (navItem.type === "folder") {
                      const isCollapsed = collapsedFolders.includes(navItem.id);
                      const selected = selectedFolderId === navItem.id;
                      return (
                        <View style={{ flexDirection: "row", gap: 4 }}>
                          <Pressable
                            onPress={() => { setSelectedFolderId(navItem.id); setSelectedAddress(null); }}
                            style={{ flex: 1, padding: 9, backgroundColor: selected ? "#152032" : "#101010", borderRadius: 8, borderWidth: 1, borderColor: selected ? "#3b82f6" : "#252525" }}
                          >
                            <T style={{ fontWeight: "700" }}>{navItem.name}</T>
                            <T style={{ color: "#777", fontSize: 12 }}>{navItem.inboxes.length} inbox(es) · {navItem.count} message(s)</T>
                          </Pressable>
                          <Pressable onPress={() => toggleInboxFolder(navItem.id)} accessibilityLabel={`Toggle ${navItem.name}`} style={{ padding: 9, backgroundColor: "#101010", borderRadius: 8, borderWidth: 1, borderColor: "#252525", justifyContent: "center" }}>
                            <T>{isCollapsed ? "+" : "−"}</T>
                          </Pressable>
                        </View>
                      );
                    }
                    const address = navItem.address;
                    const list = groups[address] || [];
                    const selected = !selectedFolderId && address === selectedAddress;
                    return (
                      <Pressable
                        onPress={() => { setSelectedFolderId(null); setSelectedAddress(address); }}
                        style={({ pressed }) => ({
                          padding: 10,
                          paddingLeft: navItem.folderId ? 22 : 10,
                          backgroundColor: selected ? "#0f0f0f" : pressed ? "#0a0a0a" : "#050505",
                          borderRadius: 10,
                          borderWidth: 1,
                          borderColor: selected ? "#2a2a2a" : "#1a1a1a",
                        })}
                      >
                        <T style={{ fontSize: 15, fontWeight: "600", marginBottom: 2 }}>{address}</T>
                        <T style={{ color: "#bbb" }} numberOfLines={1}>{list[0]?.subject ?? ""}</T>
                        <T style={{ color: "#666", marginTop: 4 }}>{list.length} message(s)</T>
                      </Pressable>
                    );
                  }}
                />
              </FadeSlideIn>
            )}

          {!isNarrow && !layout.collapsedInboxes && <ColumnResizer onResize={startResize("inboxesWidth")} />}

          {layout.collapsedMessages
            ? collapsedRail("▸", () => updateLayout({ collapsedMessages: false }))
            : (
              <FadeSlideIn delay={180} style={[columnStyle("messagesWidth"), { borderRightWidth: isNarrow ? 0 : 1, borderRightColor: "#111", padding: 8 }]}>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                  <Heading style={{ fontSize: 20, fontWeight: "700", marginBottom: 8 }}>
                    <TypewriterText text="Messages" startDelayMs={600} pauseAtEndMs={0} />
                  </Heading>
                  <Pressable onPress={() => updateLayout({ collapsedMessages: true })} accessibilityLabel="Collapse messages column"><T style={{ color: "#888", paddingHorizontal: 6 }}>‹</T></Pressable>
                </View>
                {selectedFolder && <T style={{ color: "#8ab4f8", marginBottom: 6 }} numberOfLines={1}>Folder: {selectedFolder.folder.name}</T>}
                {selectedAddress && !selectedFolder && <T style={{ color: "#8ab4f8", marginBottom: 6 }} numberOfLines={1}>Inbox: {selectedAddress}</T>}
                <View style={{ flexDirection: isNarrow ? "column" : "row", gap: 6, marginBottom: 8 }}>
                  <TextInput value={messageSearch} onChangeText={setMessageSearch} placeholder="Filter by sender, subject, or text" placeholderTextColor="#666" style={{ flex: 1, minWidth: 0, backgroundColor: "#0a0a0a", borderColor: "#252525", borderWidth: 1, borderRadius: 7, padding: 8, color: "#fff" }} />
                  <Pressable onPress={() => setMessageSort((sort) => sort === "newest" ? "oldest" : sort === "oldest" ? "sender" : sort === "sender" ? "subject" : "newest")} style={{ borderWidth: 1, borderColor: "#333", borderRadius: 7, paddingHorizontal: 10, justifyContent: "center", minHeight: 38 }}><T>Sort: {messageSort === "newest" ? "Newest" : messageSort === "oldest" ? "Oldest" : messageSort === "sender" ? "Sender" : "Subject"}</T></Pressable>
                </View>
                {messages.length ? (
                  <FlatList
                    data={messages}
                    keyExtractor={(m) => m.id}
                    ItemSeparatorComponent={() => <View style={{ height: 6 }} />}
                    renderItem={({ item }) => {
                      const selected = item.id === selectedMessageId;
                      return (
                        <Pressable
                          onPress={() => setSelectedMessageId(item.id)}
                          style={({ pressed }) => ({
                            padding: 10,
                            backgroundColor: selected ? "#101010" : pressed ? "#0a0a0a" : "#050505",
                            borderRadius: 10,
                            borderWidth: 1,
                            borderColor: selected ? "#2a2a2a" : "#1a1a1a",
                          })}
                        >
                          <T style={{ fontSize: 15, fontWeight: "600" }}>{item.subject}</T>
                          <T style={{ color: "#bbb" }} numberOfLines={1}>{item.snippet}</T>
                          <T style={{ color: "#666", marginTop: 4 }}>From: {item.from}</T>
                          {!!selectedFolder && <T style={{ color: "#666", marginTop: 2 }}>Inbox: {item.to}</T>}
                        </Pressable>
                      );
                    }}
                  />
                ) : (
                  <T style={{ color: "#888" }}>{selectedFolder || selectedAddress ? "No messages match this filter." : "Select a virtual inbox or folder on the left."}</T>
                )}
              </FadeSlideIn>
            )}

          {!isNarrow && !layout.collapsedMessages && !layout.collapsedMessage && <ColumnResizer onResize={startResize("messagesWidth")} />}

          {layout.collapsedMessage
            ? collapsedRail("▸", () => updateLayout({ collapsedMessage: false }))
            : (
              <FadeSlideIn delay={260} style={{ flex: 1, padding: 12, maxHeight: "100%", overflow: Platform.OS === "web" ? "scroll" : undefined }}>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                  <Heading style={{ fontSize: 20, fontWeight: "700", marginBottom: 8 }}>
                    <TypewriterText text="Message" startDelayMs={1000} pauseAtEndMs={900} />
                  </Heading>
                  <Pressable onPress={() => updateLayout({ collapsedMessage: true })} accessibilityLabel="Collapse message column"><T style={{ color: "#888", paddingHorizontal: 6 }}>›</T></Pressable>
                </View>
                {selectedMessage ? (
                  <View style={{ flex: 1, maxHeight: "100%", overflow: Platform.OS === "web" ? "scroll" : undefined }}>
                    <Heading style={{ fontSize: 18, fontWeight: "700", marginBottom: 8 }}>{selectedMessage.subject}</Heading>
                    <T style={{ color: "#bbb" }}>From: {selectedMessage.from}</T>
                    <T style={{ color: "#bbb" }}>To: {selectedMessage.to}</T>
                    <T style={{ color: "#666", marginBottom: 12 }}>{new Date(selectedMessage.date).toLocaleString()}</T>
                    <View style={{ flex: 1, minHeight: 300 }}>
                      {selectedMessage.bodyHtml ? (
                        <HtmlViewer html={selectedMessage.bodyHtml} />
                      ) : (
                        <T style={{ lineHeight: 22 }}>{selectedMessage.bodyText || selectedMessage.body}</T>
                      )}
                    </View>
                  </View>
                ) : (
                  <T style={{ color: "#888" }}>Select a message from the middle column.</T>
                )}
              </FadeSlideIn>
            )}
        </View>
      )}
    </View>
  );
}

// Advanced practice telemetry for LeetCode. The existing submission pipeline
// remains the only completion channel. This client reports observed timer deltas,
// including unfinished work, with an account-scoped durable event outbox.
(function () {
  "use strict";
  const T = (globalThis.Traverse = globalThis.Traverse || {});
  class PracticeClient {
    constructor() {
      this.owner = crypto.randomUUID();
      this.record = null;
      this.storageKey = null;
      this.busy = false;
      this.lastSlug = null;
      this.lastSample = performance.now();
      this.backend = T.BackendAPI ? new T.BackendAPI() : null;
    }
    async request(path, method = "GET", body, key) {
      if (!this.backend || !(await this.backend.initialize()))
        throw new Error("Sign in required");
      const reply = await new Promise((resolve) =>
        chrome.runtime.sendMessage(
          {
            type: "BACKEND_API_FETCH",
            url: `${T.config.backendBaseURL}${path}`,
            timeoutMs: 15000,
            options: {
              method,
              headers: {
                "Content-Type": "application/json",
                "ngrok-skip-browser-warning": "true",
                Authorization: `Bearer ${this.backend.authToken}`,
                ...(key ? { "Idempotency-Key": key } : {}),
              },
              ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            },
          },
          resolve,
        ),
      );
      if (!reply?.success)
        throw new Error(
          reply?.data?.error ||
            reply?.error ||
            `Practice request failed (${reply?.status})`,
        );
      return reply.data;
    }
    async scope() {
      const data = await chrome.storage.local.get([T.config.keys.auth.user]);
      const user = data[T.config.keys.auth.user];
      const id = user?.workosUserId || user?.id || user?.userId || user?.uid;
      if (!id) return false;
      const key = `traverse.practice.events.v1.${encodeURIComponent(id)}`;
      if (key !== this.storageKey) {
        this.storageKey = key;
        this.record = (await chrome.storage.local.get([key]))[key] || null;
        this.lastSlug = null;
      }
      return true;
    }
    async persist() {
      if (this.storageKey)
        await chrome.storage.local.set({ [this.storageKey]: this.record });
    }
    event(kind, seconds = 0) {
      const r = this.record;
      const last =
        r.events[r.events.length - 1]?.sequence ?? r.session.lastSequence;
      r.events.push({
        sequence: last + 1,
        kind,
        activeSeconds: Math.max(0, Math.min(600, Math.floor(seconds))),
      });
      r.desiredState =
        kind === "pause"
          ? "paused"
          : kind === "resume"
            ? "active"
            : kind === "end"
              ? "ended"
              : r.desiredState;
    }
    async flush() {
      const r = this.record;
      if (!r?.session || !r.events.length) return;
      const session = await this.request(
        `/api/v1/practice/sessions/${r.session.sessionId}/events`,
        "POST",
        {
          events: r.events.slice(0, 50),
          assistance: r.assistance || "unknown",
        },
      );
      r.session = session;
      r.events = r.events.filter(
        (event) => event.sequence > session.lastSequence,
      );
      await this.persist();
    }
    async sample() {
      if (this.busy) return;
      this.busy = true;
      try {
        if (!(await this.scope())) return;
        const now = performance.now();
        const elapsedSample = (now - this.lastSample) / 1000;
        this.lastSample = now;
        const stored = (await chrome.storage.local.get([this.storageKey]))[
          this.storageKey
        ];
        // Another live tab owns the stream. Backend also rejects parallel starts.
        if (stored?.owner !== this.owner && stored?.leaseUntil > Date.now())
          return;
        if (stored && stored.owner !== this.owner) {
          this.record = stored;
          this.record.baseline = null;
        }
        const timer = T.ProblemTimer?.getInstance();
        const slug = location.pathname.match(/^\/problems\/([^/]+)/)?.[1];
        const active =
          !!timer?.problemUrl && !timer.isPaused && !document.hidden;
        const seconds = Math.floor((timer?.getElapsedActiveTime() || 0) / 1000);
        if (this.record) {
          this.record.owner = this.owner;
          this.record.leaseUntil = Date.now() + 45000;
          await this.persist();
          // Recovered/closed-tab time is omitted. Resume only observed activity.
          if (
            this.record.session &&
            this.record.slug !== slug &&
            this.record.desiredState !== "ended"
          )
            this.event("end");
          if (
            this.record.session &&
            this.record.slug === slug &&
            this.record.desiredState !== "ended"
          ) {
            if (this.record.desiredState === "paused" && active)
              this.event("resume");
            const delta =
              this.record.baseline === null || !active || elapsedSample > 30
                ? 0
                : Math.max(
                    0,
                    Math.min(
                      seconds - this.record.baseline,
                      Math.ceil(elapsedSample) + 1,
                    ),
                  );
            if (delta > 0) this.event("progress", delta);
            if (this.record.desiredState === "active" && !active)
              this.event("pause");
            this.record.baseline = seconds;
          }
          await this.persist();
          await this.flush();
        }
        if (
          !slug ||
          !active ||
          this.lastSlug === slug ||
          (this.record?.session &&
            (this.record.events.length || this.record.desiredState !== "ended"))
        )
          return;
        if (!this.record || this.record.slug !== slug || this.record.session) {
          const plan = await this.request("/api/v1/practice/plans/today");
          const task = plan.items?.find(
            (item) => item.problem.slug === slug && item.status === "pending",
          );
          if (!task) {
            this.lastSlug = slug;
            return;
          }
          this.record = {
            slug,
            taskId: task.taskId,
            catalogId: task.problem.id,
            key: crypto.randomUUID(),
            session: null,
            events: [],
            baseline: seconds,
            desiredState: "active",
            assistance: "unknown",
            owner: this.owner,
            leaseUntil: Date.now() + 45000,
          };
          await this.persist();
        }
        if (!this.record.session) {
          this.record.session = await this.request(
            "/api/v1/practice/sessions",
            "POST",
            {
              taskId: this.record.taskId,
              catalogId: this.record.catalogId,
              source: "extension",
            },
            this.record.key,
          );
          this.record.baseline = seconds;
          await this.persist();
          this.lastSlug = slug;
        }
      } catch (error) {
        // Keep exactly the same request key and sequence bodies for reconnection.
        T.createLogger?.("practice").warn(
          "Activity sync pending:",
          error.message,
        );
      } finally {
        this.busy = false;
        if (this.pendingAccepted) {
          const pending = this.pendingAccepted;
          this.pendingAccepted = null;
          void this.accepted(pending.assistance);
        }
      }
    }
    async accepted(assistance) {
      // Wait for the single sampling writer before appending an end event.
      if (this.busy) {
        this.pendingAccepted = { assistance };
        return false;
      }
      this.busy = true;
      try {
        if (
          !(await this.scope()) ||
          !this.record?.session ||
          this.record.desiredState === "ended"
        )
          return false;
        const stored = (await chrome.storage.local.get([this.storageKey]))[
          this.storageKey
        ];
        if (stored?.owner !== this.owner && stored?.leaseUntil > Date.now())
          return false;
        if (stored?.session?.sessionId === this.record.session.sessionId)
          this.record = stored;
        const slug = location.pathname.match(/^\/problems\/([^/]+)/)?.[1];
        if (this.record.slug !== slug || this.record.owner !== this.owner)
          return false;
        this.record.assistance = ["none", "hint", "solution"].includes(
          assistance,
        )
          ? assistance
          : "unknown";
        this.event("end");
        this.lastSlug = slug;
        await this.persist();
        await this.flush();
        return true;
      } catch {
        return false;
      } finally {
        this.busy = false;
      }
    }
  }
  T.PracticeClient = PracticeClient;
  if (
    typeof location !== "undefined" &&
    /(^|\.)leetcode\.com$/.test(location.hostname)
  ) {
    T.practiceClient = new PracticeClient();
    setInterval(() => {
      void T.practiceClient.sample();
    }, 15000);
    window.addEventListener("online", () => {
      void T.practiceClient.sample();
    });
  }
})();

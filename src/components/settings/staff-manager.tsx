"use client";

import * as React from "react";
import { useActionState, useState } from "react";
import Link from "next/link";
import { KeyRound, Loader2, Pencil, Plus, Power, UserCheck, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogBody,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  STAFF_ASSIGNABLE_ROLES,
  STAFF_PASSWORD_MIN_LENGTH,
  STAFF_ROLE_LABELS,
} from "@/lib/staff/constants";
import type { StaffListResult, StaffMemberView } from "@/lib/staff/staff-service";
import {
  createStaffAction,
  resetStaffPasswordAction,
  setStaffActiveAction,
  updateStaffAction,
  type StaffActionState,
} from "@/actions/staff/actions";
import { useCloseOnSuccess } from "@/components/admin/admin-hooks";

function StateNote({ state }: { state: StaffActionState }) {
  if (!state.message) return null;
  return (
    <div
      className={`rounded-lg px-3 py-2 text-sm ${
        state.success
          ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200"
          : "bg-destructive/10 text-destructive"
      }`}
    >
      {state.message}
    </div>
  );
}

function FieldError({ errors }: { errors?: string[] }) {
  if (!errors || errors.length === 0) return null;
  return <p className="text-sm text-destructive">{errors[0]}</p>;
}

const OWNER_ROLE = "OWNER";

/** Only an owner may hand out the owner role; a manager never sees it. */
function rolesFor(canAssignOwner: boolean): string[] {
  return canAssignOwner
    ? [...STAFF_ASSIGNABLE_ROLES]
    : STAFF_ASSIGNABLE_ROLES.filter((role) => role !== OWNER_ROLE);
}

function RoleField({
  value,
  onValueChange,
  disabled,
  options,
}: {
  value: string;
  onValueChange: (value: string) => void;
  disabled?: boolean;
  options: string[];
}) {
  return (
    <Select value={value} onValueChange={(v) => onValueChange(v ?? "")} disabled={disabled}>
      <SelectTrigger className="w-full">
        <SelectValue placeholder="Select role" />
      </SelectTrigger>
      <SelectContent>
        {options.map((role) => (
          <SelectItem key={role} value={role} disabled={role === OWNER_ROLE && value !== OWNER_ROLE}>
            {STAFF_ROLE_LABELS[role] ?? role}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/* ------------------------------------------------------------------ */
/* Add staff                                                           */
/* ------------------------------------------------------------------ */

function AddStaffDialog({ canAssignOwner }: { canAssignOwner: boolean }) {
  const [state, formAction, pending] = useActionState<StaffActionState, FormData>(
    createStaffAction,
    {}
  );
  const [open, setOpen] = useState(false);
  const options = rolesFor(canAssignOwner);
  const [role, setRole] = useState<string>(options[0] ?? "CASHIER");

  useCloseOnSuccess(state, setOpen);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button onClick={() => setOpen(true)}>
        <Plus />
        Add staff
      </Button>
      <DialogPopup className="sm:max-w-lg">
        <form action={formAction} key={state.success ? "added" : "add"}>
          <DialogHeader>
            <DialogTitle>Add staff</DialogTitle>
            <DialogDescription>
              They can sign in immediately with the email and password you set here.
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <StateNote state={state} />
            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="staff-name">Full name</Label>
                <Input id="staff-name" name="fullName" autoComplete="off" />
                <FieldError errors={state._errors?.fullName} />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="staff-email">Email / username</Label>
                  <Input id="staff-email" name="email" type="email" autoComplete="off" />
                  <FieldError errors={state._errors?.email} />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="staff-phone">Phone</Label>
                  <Input id="staff-phone" name="phone" inputMode="tel" autoComplete="off" />
                  <FieldError errors={state._errors?.phone} />
                </div>
              </div>
              <div className="grid gap-2">
                <Label>Role</Label>
                <RoleField value={role} onValueChange={setRole} options={options} />
                <input type="hidden" name="role" value={role} />
                <FieldError errors={state._errors?.role} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="staff-password">Temporary password</Label>
                <Input
                  id="staff-password"
                  name="password"
                  type="password"
                  autoComplete="new-password"
                />
                <p className="text-xs text-muted-foreground">
                  At least {STAFF_PASSWORD_MIN_LENGTH} characters. Share it securely — it is
                  stored hashed and never shown again.
                </p>
                <FieldError errors={state._errors?.password} />
              </div>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="animate-spin" />}
              Add staff
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Edit staff                                                          */
/* ------------------------------------------------------------------ */

function EditStaffDialog({
  member,
  canAssignOwner,
}: {
  member: StaffMemberView;
  canAssignOwner: boolean;
}) {
  const [state, formAction, pending] = useActionState<StaffActionState, FormData>(
    updateStaffAction,
    {}
  );
  const [open, setOpen] = useState(false);
  const options = rolesFor(canAssignOwner);
  const [role, setRole] = useState<string>(member.role);

  useCloseOnSuccess(state, setOpen);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Pencil />
        Edit
      </Button>
      <DialogPopup className="sm:max-w-lg">
        <form action={formAction} key={state.success ? `saved-${member.userId}` : "edit"}>
          <DialogHeader>
            <DialogTitle>Edit {member.fullName}</DialogTitle>
            <DialogDescription>Changes apply the next time they load the app.</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <input type="hidden" name="userId" value={member.userId} />
            <StateNote state={state} />
            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor={`edit-name-${member.userId}`}>Full name</Label>
                <Input
                  id={`edit-name-${member.userId}`}
                  name="fullName"
                  defaultValue={member.fullName}
                />
                <FieldError errors={state._errors?.fullName} />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor={`edit-email-${member.userId}`}>Email / username</Label>
                  <Input
                    id={`edit-email-${member.userId}`}
                    name="email"
                    type="email"
                    defaultValue={member.email}
                  />
                  <FieldError errors={state._errors?.email} />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor={`edit-phone-${member.userId}`}>Phone</Label>
                  <Input
                    id={`edit-phone-${member.userId}`}
                    name="phone"
                    inputMode="tel"
                    defaultValue={member.phone ?? ""}
                  />
                  <FieldError errors={state._errors?.phone} />
                </div>
              </div>
              <div className="grid gap-2">
                <Label>Role</Label>
                <RoleField
                  value={role}
                  onValueChange={setRole}
                  options={options}
                  disabled={member.isOwner}
                />
                <input type="hidden" name="role" value={role} />
                {member.isOwner && (
                  <p className="text-xs text-muted-foreground">
                    The restaurant owner keeps the owner role and stays active.
                  </p>
                )}
                <FieldError errors={state._errors?.role} />
              </div>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="animate-spin" />}
              Save changes
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Activate / deactivate                                               */
/* ------------------------------------------------------------------ */

function ToggleActiveButton({
  member,
  isSelf,
}: {
  member: StaffMemberView;
  isSelf: boolean;
}) {
  const [state, formAction, pending] = useActionState<StaffActionState, FormData>(
    setStaffActiveAction,
    {}
  );
  const [confirming, setConfirming] = useState(false);

  useCloseOnSuccess(state, () => setConfirming(false));

  if (member.isOwner || isSelf) {
    return (
      <span className="text-xs text-muted-foreground">
        {member.isOwner ? "Owner" : "You"}
      </span>
    );
  }

  // Reactivation is reversible, so it submits straight away. Deactivating signs
  // the person out everywhere, so it asks first.
  if (!member.isActive) {
    return (
      <form action={formAction} className="inline">
        <input type="hidden" name="userId" value={member.userId} />
        <input type="hidden" name="isActive" value="true" />
        <Button variant="outline" size="sm" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : <UserCheck />}
          Activate
        </Button>
      </form>
    );
  }

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setConfirming(true)}>
        <Power />
        Deactivate
      </Button>
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogPopup className="sm:max-w-md">
          <form action={formAction}>
            <DialogHeader>
              <DialogTitle>Deactivate {member.fullName}?</DialogTitle>
              <DialogDescription>
                They will be signed out and cannot sign in again until reactivated. Their
                orders, bills and inventory history are kept.
              </DialogDescription>
            </DialogHeader>
            <DialogBody>
              <input type="hidden" name="userId" value={member.userId} />
              <input type="hidden" name="isActive" value="false" />
              <StateNote state={state} />
            </DialogBody>
            <DialogFooter>
              <Button type="submit" variant="destructive" disabled={pending}>
                {pending && <Loader2 className="animate-spin" />}
                Deactivate
              </Button>
              <Button
                type="button"
                variant="ghost"
                nativeButton={false}
                onClick={() => setConfirming(false)}
              >
                Cancel
              </Button>
            </DialogFooter>
          </form>
        </DialogPopup>
      </Dialog>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Reset password                                                      */
/* ------------------------------------------------------------------ */

function ResetPasswordDialog({ member }: { member: StaffMemberView }) {
  const [state, formAction, pending] = useActionState<StaffActionState, FormData>(
    resetStaffPasswordAction,
    {}
  );
  const [open, setOpen] = useState(false);

  useCloseOnSuccess(state, setOpen);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <KeyRound />
        Reset password
      </Button>
      <DialogPopup className="sm:max-w-md">
        <form action={formAction} key={state.success ? `done-${member.userId}` : "password"}>
          <DialogHeader>
            <DialogTitle>Reset password for {member.fullName}</DialogTitle>
            <DialogDescription>
              They will use this password until they can change it. It is stored hashed and is
              never displayed again.
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <input type="hidden" name="userId" value={member.userId} />
            <StateNote state={state} />
            <div className="grid gap-2">
              <Label htmlFor={`new-password-${member.userId}`}>New password</Label>
              <Input
                id={`new-password-${member.userId}`}
                name="newPassword"
                type="password"
                autoComplete="new-password"
              />
              <p className="text-xs text-muted-foreground">
                At least {STAFF_PASSWORD_MIN_LENGTH} characters.
              </p>
              <FieldError errors={state._errors?.newPassword} />
            </div>
          </DialogBody>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="animate-spin" />}
              Reset password
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Search + filter (plain GET form, like the admin list pages)          */
/* ------------------------------------------------------------------ */

function StaffFilters({
  search,
  role,
  status,
}: {
  search: string;
  role: string;
  status: string;
}) {
  return (
    <form method="GET" action="/settings/staff" className="mb-4 flex flex-wrap items-center gap-2">
      <Input
        name="search"
        defaultValue={search}
        placeholder="Search name, email or phone…"
        className="max-w-xs"
      />
      <select
        name="role"
        defaultValue={role}
        aria-label="Filter by role"
        className="h-8 rounded-lg border border-input bg-background px-2 text-sm"
      >
        <option value="">All roles</option>
        {STAFF_ASSIGNABLE_ROLES.map((r) => (
          <option key={r} value={r}>
            {STAFF_ROLE_LABELS[r] ?? r}
          </option>
        ))}
      </select>
      <select
        name="status"
        defaultValue={status}
        aria-label="Filter by status"
        className="h-8 rounded-lg border border-input bg-background px-2 text-sm"
      >
        <option value="">All</option>
        <option value="true">Active</option>
        <option value="false">Inactive</option>
      </select>
      <Button type="submit" variant="secondary" size="sm">
        Filter
      </Button>
      <Button
        variant="ghost"
        size="sm"
        nativeButton={false}
        render={<Link href="/settings/staff" />}
      >
        Clear
      </Button>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* Table                                                               */
/* ------------------------------------------------------------------ */

export function StaffManager({
  result,
  canEdit,
  currentUserId,
  isOwnerRole,
  filters,
}: {
  result: StaffListResult;
  canEdit: boolean;
  currentUserId: string;
  isOwnerRole: boolean;
  filters: { search: string; role: string; status: string };
}) {
  const filtered = result.items.length !== result.counts.all;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {result.counts.all} {result.counts.all === 1 ? "person" : "people"} ·{" "}
          {result.counts.active} active
          {filtered ? ` · showing ${result.items.length}` : ""}
        </p>
        {canEdit ? (
          <AddStaffDialog canAssignOwner={isOwnerRole} />
        ) : (
          <Badge variant="outline">Read only</Badge>
        )}
      </div>

      {canEdit && (
        <StaffFilters search={filters.search} role={filters.role} status={filters.status} />
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="size-4" />
            Staff
          </CardTitle>
          <CardDescription>
            {canEdit
              ? "Owners and managers can add staff, change roles, reset passwords and deactivate accounts. Deactivating keeps all their past orders and bills."
              : "Only the restaurant owner or a manager can change the staff list."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {result.items.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No staff found.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">Name</th>
                    <th className="px-3 py-2">Email / username</th>
                    <th className="px-3 py-2">Phone</th>
                    <th className="px-3 py-2">Role</th>
                    <th className="px-3 py-2">Status</th>
                    {canEdit && <th className="px-3 py-2 text-right">Actions</th>}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {result.items.map((member) => (
                    <tr key={member.userId} className="hover:bg-muted/40">
                      <td className="px-3 py-2 font-medium">
                        {member.fullName}
                        {member.isOwner && (
                          <span className="ml-2 text-xs text-muted-foreground">Owner</span>
                        )}
                      </td>
                      <td className="px-3 py-2">{member.email}</td>
                      <td className="px-3 py-2">{member.phone ?? "—"}</td>
                      <td className="px-3 py-2">
                        {STAFF_ROLE_LABELS[member.role] ?? member.role}
                      </td>
                      <td className="px-3 py-2">
                        <Badge variant={member.isActive ? "default" : "secondary"}>
                          {member.isActive ? "Active" : "Inactive"}
                        </Badge>
                      </td>
                      {canEdit && (
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap items-center justify-end gap-2">
                            <EditStaffDialog
                              member={member}
                              canAssignOwner={isOwnerRole}
                            />
                            <ResetPasswordDialog member={member} />
                            <ToggleActiveButton
                              member={member}
                              isSelf={member.userId === currentUserId}
                            />
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}

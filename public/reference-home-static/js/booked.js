/* Booking confirmation: fills the receipt saved by contact.js, then prints it. */
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  let booking = null;
  try { booking = JSON.parse(sessionStorage.getItem("ct-booking")); } catch (e) { /* storage blocked */ }
  if (!booking) return location.replace("/contact.html"); // direct visit, nothing to confirm

  $("done-name").textContent = booking.firstName;
  $("done-date").innerHTML = "";
  $("done-date").append(Object.assign(document.createElement("em"), { textContent: booking.dateLabel }));
  $("done-time").textContent = booking.time;
  $("done-services").textContent = booking.services;
  $("done-wa").href = booking.waHref;
  requestAnimationFrame(() => $("ct-done").classList.add("is-in"));
})();

const menuButton = document.querySelector(".menu-button");
const navbarMenu = document.querySelector(".navbar-menu");
const menuLinks = document.querySelectorAll(".navbar-menu a");

if (menuButton && navbarMenu) {
    menuButton.addEventListener("click", () => {
        const menuIsOpen = navbarMenu.classList.toggle("active");

        menuButton.classList.toggle("active");
        menuButton.setAttribute("aria-expanded", menuIsOpen);
    });
}

menuLinks.forEach((link) => {
    link.addEventListener("click", () => {
        navbarMenu?.classList.remove("active");
        menuButton?.classList.remove("active");
        menuButton?.setAttribute("aria-expanded", "false");
    });
});
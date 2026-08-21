"""UBS Spectral Inside, backend.

Arbejdsbord for analytikere, der scanner roefrø på VideometerLab med Autofeeder.

Denne backend læser kun. Den taler ikke med VideometerLab og kan ikke påvirke
måleprocessen. Resultatdata kommer senere ind i systemet via en separat
connector, som skriver til databasen uafhængigt af denne applikation.
"""

__version__ = "0.1.0"

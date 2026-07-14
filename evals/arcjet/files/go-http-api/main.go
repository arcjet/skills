package main

import (
	"encoding/json"
	"log"
	"net/http"
)

func search(w http.ResponseWriter, r *http.Request) {
	// The trusted authentication proxy strips caller-supplied values and sets
	// this header from the verified session before forwarding the request.
	userID := r.Header.Get("X-User-ID")
	_ = json.NewEncoder(w).Encode(map[string]string{
		"query":   r.URL.Query().Get("q"),
		"user_id": userID,
	})
}

func main() {
	http.HandleFunc("/search", search)
	log.Fatal(http.ListenAndServe(":3000", nil))
}
